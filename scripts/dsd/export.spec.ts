import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CSV_SCHEMA,
  OUTPUT_ROOT,
  PROVENANCE_FIELDS,
  actorRef,
  buildSqlite,
  describeArtifacts,
  normalizeSqliteHeader,
  occurredOn,
  smokeTestSqlite,
} from './export';
import { csvBytes, jsonlBytes, sha256 } from './lib/release-package';

describe('the native module smoke test', () => {
  it('loads better-sqlite3 and round-trips a value', () => {
    // Run before anything is written, so an ABI mismatch fails immediately
    // rather than after twenty minutes of copying audio.
    const result = smokeTestSqlite();
    expect(result.ok).toBe(true);
    expect(result.sqliteVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('deterministic SQLite', () => {
  let temp: string;

  const tables = {
    entries: {
      columns: CSV_SCHEMA.entries,
      rows: [
        ['11111111-1111-1111-1111-111111111111', 'rehearse', 'rehearse', 'en', 'core-1000'],
        ['22222222-2222-2222-2222-222222222222', 'practise', 'practise', 'en', null],
      ] as Array<Array<string | number | null>>,
    },
    senses: {
      columns: CSV_SCHEMA.senses,
      rows: [
        ['33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 1, 'verb', 'To practise beforehand.', 'general'],
      ] as Array<Array<string | number | null>>,
    },
  };

  beforeEach(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsd-sqlite-'));
  });

  it('produces byte-identical files from the same rows', () => {
    // The acceptance criterion: two exports from the same snapshot are
    // byte-identical, which is what lets anyone check a package without
    // trusting the machine that built it.
    const first = path.join(temp, 'a.sqlite');
    const second = path.join(temp, 'b.sqlite');
    buildSqlite(first, tables);
    buildSqlite(second, tables);

    expect(sha256(fs.readFileSync(first))).toBe(sha256(fs.readFileSync(second)));
  });

  it('produces different files for different rows', () => {
    const first = path.join(temp, 'a.sqlite');
    const second = path.join(temp, 'b.sqlite');
    buildSqlite(first, tables);
    buildSqlite(second, {
      ...tables,
      entries: { columns: CSV_SCHEMA.entries, rows: [tables.entries.rows[0]] },
    });
    expect(sha256(fs.readFileSync(first))).not.toBe(sha256(fs.readFileSync(second)));
  });

  it('is queryable, with the rows in the order they were given', () => {
    const file = path.join(temp, 'q.sqlite');
    buildSqlite(file, tables);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const db = new Database(file, { readonly: true });
    try {
      const rows = db.prepare('SELECT entry_id, headword FROM entries').all();
      expect(rows.map((row: any) => row.headword)).toEqual(['rehearse', 'practise']);
      expect(db.prepare('SELECT count(*) AS n FROM senses').get().n).toBe(1);
    } finally {
      db.close();
    }
  });

  it('preserves a null distinctly from an empty string', () => {
    const file = path.join(temp, 'n.sqlite');
    buildSqlite(file, tables);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const db = new Database(file, { readonly: true });
    try {
      const bands = db.prepare('SELECT dsd_band FROM entries ORDER BY headword').all();
      expect(bands.map((row: any) => row.dsd_band)).toEqual([null, 'core-1000']);
    } finally {
      db.close();
    }
  });

  it('leaves no staging file behind', () => {
    const file = path.join(temp, 's.sqlite');
    buildSqlite(file, tables);
    expect(fs.existsSync(`${file}.staging`)).toBe(false);
  });

  it('overwrites a previous build rather than appending to it', () => {
    const file = path.join(temp, 'o.sqlite');
    buildSqlite(file, tables);
    const first = sha256(fs.readFileSync(file));
    buildSqlite(file, tables);
    expect(sha256(fs.readFileSync(file))).toBe(first);
  });

  it('zeroes the header counters that track write history', () => {
    // Bytes 24–27 and 92–95 record change counts, not content. Left in, two
    // exports of identical data would differ.
    const file = path.join(temp, 'h.sqlite');
    buildSqlite(file, tables);
    const header = fs.readFileSync(file).subarray(0, 100);
    expect(header.readUInt32BE(24)).toBe(0);
    expect(header.readUInt32BE(92)).toBe(0);
  });

  it('normalizeSqliteHeader is idempotent', () => {
    const file = path.join(temp, 'i.sqlite');
    buildSqlite(file, tables);
    const before = sha256(fs.readFileSync(file));
    normalizeSqliteHeader(file);
    expect(sha256(fs.readFileSync(file))).toBe(before);
  });
});

describe('release-scoped contributor references', () => {
  it('is stable within a release, so author ≠ reviewer stays provable', () => {
    expect(actorRef('REL-1', 'DSD-A-001')).toBe(actorRef('REL-1', 'DSD-A-001'));
    expect(actorRef('REL-1', 'DSD-A-001')).not.toBe(actorRef('REL-1', 'DSD-R-001'));
  });

  it('differs between releases, so two packages cannot be correlated', () => {
    // Otherwise a customer with two packages could build a picture of who works
    // on what.
    expect(actorRef('REL-1', 'DSD-A-001')).not.toBe(actorRef('REL-2', 'DSD-A-001'));
  });

  it('reveals nothing about the underlying identifier', () => {
    const ref = actorRef('REL-1', 'DSD-A-001');
    expect(ref).toMatch(/^[0-9a-f]{16}$/);
    expect(ref).not.toContain('DSD');
  });
});

describe('occurredOn', () => {
  it('keeps the date and drops the time', () => {
    // An exact event time is closer to personal data than a date is.
    expect(occurredOn('2026-08-04T13:45:12.345Z')).toBe('2026-08-04');
  });
});

describe('the provenance export schema', () => {
  it('carries only the reviewed fields', () => {
    const line = jsonlBytes([
      {
        entity_kind: 'sense',
        entity_id: '33333333-3333-3333-3333-333333333333',
        event_type: 'approved',
        actor_ref: actorRef('REL-1', 'DSD-R-001'),
        output_hash: 'a'.repeat(64),
        occurred_on: '2026-08-04',
      },
    ]).toString();

    const parsed = JSON.parse(line.trim());
    expect(Object.keys(parsed).sort()).toEqual([...PROVENANCE_FIELDS].sort());
  });

  it('names no contributor and no evidence location', () => {
    const line = jsonlBytes([
      {
        entity_kind: 'sense',
        entity_id: 'x',
        event_type: 'approved',
        actor_ref: actorRef('REL-1', 'DSD-R-001'),
        output_hash: '',
        occurred_on: '2026-08-04',
      },
    ]).toString();
    expect(line).not.toMatch(/DSD-A-|DSD-R-|EV-IP-|evidence/i);
  });
});

describe('CSV schemas are fixed', () => {
  it('has a stable column order per table', () => {
    // Reordering a column changes every byte after it, breaking the signature of
    // every package built before the change.
    expect(CSV_SCHEMA.entries).toEqual([
      'entry_id', 'headword', 'headword_normalized', 'language', 'dsd_band',
    ]);
    expect(CSV_SCHEMA.senses[0]).toBe('sense_id');
    expect(CSV_SCHEMA.audio).toContain('sha256');
    expect(CSV_SCHEMA.audio).toContain('path');
  });

  it('names no contributor or review column in any table', () => {
    for (const columns of Object.values(CSV_SCHEMA)) {
      for (const column of columns) {
        expect(column).not.toMatch(/authored|reviewed|batch|evidence|source_id|status/);
      }
    }
  });

  it('identifies every row by a DSD UUID column', () => {
    for (const [table, columns] of Object.entries(CSV_SCHEMA)) {
      expect(columns.some((column) => column.endsWith('_id'))).toBe(true);
      // No legacy integer identity anywhere.
      expect(columns).not.toContain('word_id');
      expect(columns).not.toContain('definition_id');
      expect(table).toBeTruthy();
    }
  });
});

describe('describeArtifacts', () => {
  it('hashes and sizes every file, sorted by path', () => {
    const artifacts = describeArtifacts([
      { path: 'b.csv', bytes: Buffer.from('bb') },
      { path: 'a.csv', bytes: Buffer.from('a') },
    ]);
    expect(artifacts.map((artifact) => artifact.path)).toEqual(['a.csv', 'b.csv']);
    expect(artifacts[0]).toMatchObject({ bytes: 1, sha256: sha256(Buffer.from('a')) });
  });
});

describe('what the export refuses', () => {
  const code = fs
    .readFileSync(path.resolve(__dirname, 'export.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('requires SOURCE_DATE_EPOCH', () => {
    expect(code).toMatch(/SOURCE_DATE_EPOCH must be set/);
  });

  it('refuses to overwrite an existing directory', () => {
    expect(code).toMatch(/already exists\. An export never overwrites/);
  });

  it('reads corpus rows in a repeatable-read, read-only transaction', () => {
    expect(code).toMatch(
      /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/,
    );
  });

  it('records the build in a separate connection, never the read one', () => {
    // The export transaction must never be writable.
    expect(code).toMatch(/createDsdDataSource\('audit'/);
    expect(code).toMatch(/createDsdDataSource\('curator'/);
    const readSection = code.slice(0, code.indexOf('const writeDs'));
    expect(readSection).not.toMatch(/INSERT INTO dsd_release_builds/);
  });

  it('exports only published and accepted rows', () => {
    const selects = code.match(/WHERE[\s\S]*?ORDER BY/g) ?? [];
    expect(selects.length).toBeGreaterThan(5);
    for (const clause of selects) {
      expect(clause).toMatch(/'published'|'accepted'/);
    }
  });

  it('excludes drafts, candidates and rejected rows', () => {
    expect(code).not.toMatch(/'draft'|'in_review'|'rejected'|dsd_ipa_candidates/);
  });

  it('names no legacy table', () => {
    for (const table of ['words', 'learner_entries', 'definitions ', 'synonyms']) {
      expect(code).not.toContain(table);
    }
  });

  it('verifies the audio hash while copying', () => {
    expect(code).toMatch(/hashes \$\{actual\.slice\(0, 12\)/);
  });

  it('exports only audio bound to a published pronunciation of the same entry', () => {
    expect(code).toMatch(
      /JOIN dsd_pronunciations p[\s\S]*p\.id = a\.input_record_id[\s\S]*p\.dsd_entry_id = a\.dsd_entry_id/,
    );
    expect(code).toMatch(/a\.input_kind = 'pronunciation'/);
  });

  it('verifies the package before recording the build', () => {
    const verifyAt = code.indexOf('verifyRelease({');
    const recordAt = code.indexOf('INSERT INTO dsd_release_builds');
    expect(verifyAt).toBeGreaterThan(-1);
    expect(verifyAt).toBeLessThan(recordAt);
  });

  it('records the exact manifest bytes and every exported record membership', () => {
    expect(code).toMatch(/INSERT INTO dsd_release_builds[\s\S]*manifest_bytes/);
    for (const table of [
      'dsd_release_entries',
      'dsd_release_senses',
      'dsd_release_translations',
      'dsd_release_examples',
      'dsd_release_pronunciations',
      'dsd_release_relations',
      'dsd_release_audio_assets',
    ]) {
      expect(code).toContain(table);
    }
  });

  it('counts authored relations once even when the serving view projects both directions', () => {
    expect(code).toMatch(
      /relations: new Set\(rows\.relations\.map\(\(relation\) => relation\.relation_id\)\)\.size/,
    );
  });

  it('refuses a signer key absent from the reviewed registry', () => {
    expect(code).toMatch(/is not in data\/dsd\/release-public-keys\.json/);
  });

  it('takes the private key from the environment, never from the repository', () => {
    expect(code).toMatch(/DSD_RELEASE_SIGNING_KEY_PEM/);
    expect(code).toMatch(/never in this repository and never in a package/);
  });

  it('refuses to generate the licence documents from a template', () => {
    // These state what a customer may do with the data; generating one would be
    // inventing legal terms.
    expect(code).toMatch(/inventing legal terms/);
  });

  it('writes under dist, which is not committed', () => {
    expect(OUTPUT_ROOT).toBe('dist/dsd-corpus');
  });
});
