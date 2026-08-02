/**
 * Proves the DSD permission boundary against a real PostgreSQL instance.
 *
 * This is the test that keeps the licensing boundary honest. Task 8 needs the
 * legacy English to measure similarity; it must never be able to read the
 * unlicensed tudien Vietnamese, the learner overlay, or the cleanup backups.
 * A comment in a SQL file does not enforce that. A denied SELECT does.
 *
 * Requires the local Postgres container. Skips with an explanation when it is
 * unavailable so the suite stays green elsewhere.
 */
import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const LEGACY_DB = process.env.DB_DATABASE || 'english_learning_db';
const HOST = process.env.DB_HOST || 'localhost';
const PORT = parseInt(process.env.DB_PORT || '5432', 10);
const SUPERUSER = process.env.DB_USERNAME || 'dictionary_user';
const SUPERPASS = process.env.DB_PASSWORD || '';
const READER = 'dsd_similarity_reader';
const READER_PASS = 'reader_spec_only';

const AUDIT_VIEW = 'dsd_compliance.english_similarity_input';

async function connect(user: string, password: string, database: string): Promise<Client> {
  const client = new Client({ host: HOST, port: PORT, user, password, database });
  await client.connect();
  return client;
}

async function probe(): Promise<string | null> {
  try {
    const client = await connect(SUPERUSER, SUPERPASS, LEGACY_DB);
    await client.end();
    return null;
  } catch (error: any) {
    return error?.message ?? String(error);
  }
}

let skipReason: string | null = null;
let admin: Client;
let reader: Client;

beforeAll(async () => {
  skipReason = await probe();
  if (skipReason) return;

  admin = await connect(SUPERUSER, SUPERPASS, LEGACY_DB);

  // The committed SQL creates the role NOLOGIN so no password lives in Git.
  // Grant a throwaway one for the duration of this spec.
  const sql = fs.readFileSync(
    path.resolve(__dirname, 'grant-legacy-similarity-reader.sql'),
    'utf8',
  );
  // Strip psql meta-commands the driver cannot parse.
  await admin.query(sql.replace(/^\\.*$/gm, ''));
  await admin.query(`ALTER ROLE ${READER} LOGIN PASSWORD '${READER_PASS}'`);

  reader = await connect(READER, READER_PASS, LEGACY_DB);
}, 120_000);

afterAll(async () => {
  if (reader) await reader.end();
  if (admin) {
    await admin.query(`ALTER ROLE ${READER} NOLOGIN`);
    await admin.end();
  }
});

function itDb(name: string, fn: () => Promise<void>, timeout = 60_000) {
  it(name, async () => {
    if (skipReason) {
      // eslint-disable-next-line no-console
      console.warn(`[permissions.spec] skipped: ${skipReason.split('\n')[0]}`);
      return;
    }
    await fn();
  }, timeout);
}

async function expectDenied(sql: string): Promise<void> {
  await expect(reader.query(sql)).rejects.toThrow(/permission denied|does not exist/i);
}

describe('dsd_similarity_reader — allowlist', () => {
  itDb('can read the compliance audit view', async () => {
    const result = await reader.query(`SELECT * FROM ${AUDIT_VIEW} LIMIT 1`);
    expect(result.rowCount).toBe(1);
  });

  itDb('sees only the five approved columns', async () => {
    const result = await reader.query(`SELECT * FROM ${AUDIT_VIEW} LIMIT 1`);
    expect(result.fields.map((f) => f.name).sort()).toEqual([
      'content_digest',
      'content_en',
      'headword',
      'part_of_speech',
      'record_kind',
    ]);
  });

  itDb('exposes no legacy row identifier, so no DSD row can carry one', async () => {
    const result = await reader.query(`SELECT * FROM ${AUDIT_VIEW} LIMIT 1`);
    const names = result.fields.map((f) => f.name);
    expect(names).not.toContain('id');
    expect(names.filter((n) => n.endsWith('_id'))).toEqual([]);
  });
});

describe('dsd_similarity_reader — denylist', () => {
  itDb('is denied the legacy base tables', async () => {
    for (const table of ['words', 'definitions', 'examples', 'pronunciations']) {
      await expectDenied(`SELECT * FROM ${table} LIMIT 1`);
    }
  });

  itDb('is denied the unlicensed Vietnamese columns specifically', async () => {
    await expectDenied('SELECT definition_vi FROM definitions LIMIT 1');
    await expectDenied('SELECT example_vi FROM examples LIMIT 1');
  });

  itDb('is denied every learner overlay table', async () => {
    for (const table of [
      'learner_entries',
      'learner_senses',
      'learner_sense_translations',
      'learner_examples',
      'learner_pronunciations',
    ]) {
      await expectDenied(`SELECT * FROM ${table} LIMIT 1`);
    }
  });

  itDb('is denied the cleanup backup tables holding deleted legacy text', async () => {
    const { rows } = await admin.query(
      `SELECT tablename FROM pg_tables
        WHERE schemaname='public' AND tablename LIKE 'cleanup_%' LIMIT 5`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      await expectDenied(`SELECT * FROM ${row.tablename} LIMIT 1`);
    }
  });

  itDb('cannot write to any legacy base table', async () => {
    // These are refused by privilege: the role holds no INSERT/UPDATE/DELETE.
    await expectDenied("UPDATE definitions SET definition_en = 'x'");
    await expectDenied("INSERT INTO words (word, language) VALUES ('x','en')");
    await expectDenied('DELETE FROM examples');
  });

  itDb('cannot write through the audit view', async () => {
    // Refused by a different mechanism: the view is a UNION and therefore not
    // auto-updatable, and no INSTEAD OF trigger exists. Asserted separately
    // from the privilege denials above so the two are not conflated — if the
    // view ever became updatable, this test should fail and force a grant
    // review rather than silently passing on the old reason.
    await expect(reader.query(`DELETE FROM ${AUDIT_VIEW}`)).rejects.toThrow(
      /cannot delete from view|permission denied/i,
    );
    await expect(
      reader.query(`UPDATE ${AUDIT_VIEW} SET content_en = 'x'`),
    ).rejects.toThrow(/cannot update view|permission denied/i);
  });

  itDb('cannot issue DDL', async () => {
    await expect(reader.query('CREATE TABLE dsd_reader_probe (id int)')).rejects.toThrow(
      /permission denied/i,
    );
    await expect(reader.query('DROP VIEW ' + AUDIT_VIEW)).rejects.toThrow(/must be owner|permission denied/i);
  });

  itDb('cannot reach future legacy tables through default privileges', async () => {
    await admin.query('CREATE TABLE IF NOT EXISTS dsd_default_priv_probe (id int)');
    try {
      await expectDenied('SELECT * FROM dsd_default_priv_probe LIMIT 1');
    } finally {
      await admin.query('DROP TABLE IF EXISTS dsd_default_priv_probe');
    }
  });
});
