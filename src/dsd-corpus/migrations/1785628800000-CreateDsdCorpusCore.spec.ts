import { CreateDsdCorpusCore1785628800000 } from './1785628800000-CreateDsdCorpusCore';

async function sqlOf(direction: 'up' | 'down'): Promise<string> {
  const query = jest.fn().mockResolvedValue(undefined);
  const migration = new CreateDsdCorpusCore1785628800000();
  await migration[direction]({ query } as any);
  return query.mock.calls.map(([s]) => String(s)).join('\n');
}

const DSD_TABLES = [
  'dsd_entries',
  'dsd_senses',
  'dsd_translations',
  'dsd_examples',
  'dsd_pronunciations',
  'dsd_provenance_events',
];

const CONTENT_TABLES = ['dsd_senses', 'dsd_translations', 'dsd_examples', 'dsd_pronunciations'];

describe('CreateDsdCorpusCore — isolation from legacy', () => {
  it('creates no foreign key to any legacy table', async () => {
    const sql = await sqlOf('up');
    // Every REFERENCES target must be a DSD table (invariant 1).
    const targets = [...sql.matchAll(/REFERENCES\s+"([a-z_]+)"/gi)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(DSD_TABLES).toContain(target);
    }
  });

  it('names no legacy table anywhere in the schema', async () => {
    const sql = await sqlOf('up');
    for (const legacy of [
      'words', 'definitions', 'examples', 'pronunciations',
      'learner_entries', 'learner_senses', 'cleanup_',
    ]) {
      // Word-boundary match so "dsd_examples" does not trip on "examples".
      expect(sql).not.toMatch(new RegExp(`"${legacy}"`, 'i'));
    }
  });

  it('stores no legacy row identifier', async () => {
    const sql = await sqlOf('up');
    expect(sql).not.toMatch(/legacy_\w*id/i);
    expect(sql).not.toMatch(/"word_id"|"definition_id"|"source_sense_id"/i);
  });
});

describe('CreateDsdCorpusCore — independent review', () => {
  it.each(CONTENT_TABLES)('%s requires a reviewer who is not the author', async (table) => {
    const sql = await sqlOf('up');
    const short = table.replace(/s$/, '');
    expect(sql).toContain(`CHK_${short}_independent_review`);
    expect(sql).toMatch(/"authored_by"\s*<>\s*"reviewed_by"/);
  });

  it('applies that only to approved and published rows, leaving drafts free', async () => {
    const sql = await sqlOf('up');
    expect(sql).toMatch(/"status" NOT IN \('approved','published'\)/);
  });

  it('requires a source identifier on published rows', async () => {
    const sql = await sqlOf('up');
    for (const table of CONTENT_TABLES) {
      expect(sql).toContain(`CHK_${table.replace(/s$/, '')}_published_source`);
    }
  });
});

describe('CreateDsdCorpusCore — allowlists and revisions', () => {
  it('constrains status, part of speech, locale, accent and event type', async () => {
    const sql = await sqlOf('up');
    expect(sql).toMatch(/'draft','in_review','approved','published','retired','rejected'/);
    expect(sql).toMatch(/CHK_dsd_sense_pos/);
    expect(sql).toMatch(/CHK_dsd_translation_locale/);
    expect(sql).toMatch(/CHK_dsd_pronunciation_accent/);
    expect(sql).toMatch(/CHK_dsd_event_type/);
  });

  it('carries an immutable revision and a same-table supersedes link', async () => {
    const sql = await sqlOf('up');
    for (const table of CONTENT_TABLES) {
      const short = table.replace(/s$/, '');
      expect(sql).toContain(`FK_${short}_supersedes`);
      expect(sql).toContain(`CHK_${short}_revision`);
    }
  });

  it('stores every timestamp as timestamptz, so all times are UTC-anchored', async () => {
    const sql = await sqlOf('up');
    expect(sql).not.toMatch(/timestamp(?!tz)\s/i);
  });

  it('rejects future review timestamps by trigger, since now() is not immutable', async () => {
    const sql = await sqlOf('up');
    expect(sql).toContain('dsd_reject_future_review');
    expect(sql).toMatch(/reviewed_at.*is in the future/);
  });
});

describe('CreateDsdCorpusCore — published immutability', () => {
  it('installs the guard on every content table', async () => {
    const sql = await sqlOf('up');
    for (const table of CONTENT_TABLES) {
      expect(sql).toContain(`TRG_${table}_published_immutable`);
    }
  });

  it('permits retirement but not content change', async () => {
    const sql = await sqlOf('up');
    expect(sql).toMatch(/NEW\."status" = 'retired'/);
    expect(sql).toMatch(/content_sha256" = OLD\."content_sha256"/);
    expect(sql).toMatch(/cannot be edited in place/);
  });
});

describe('CreateDsdCorpusCore — append-only provenance', () => {
  it('blocks UPDATE and DELETE on the ledger', async () => {
    const sql = await sqlOf('up');
    expect(sql).toContain('TRG_dsd_provenance_append_only');
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON "dsd_provenance_events"/);
    expect(sql).toMatch(/append-only/);
  });

  it('gates break-glass behind owner membership, not a flag alone', async () => {
    const sql = await sqlOf('up');
    expect(sql).toContain(`current_setting('dsd.break_glass', true)`);
    expect(sql).toContain(`pg_has_role(current_user, 'dsd_owner', 'MEMBER')`);
  });
});

describe('CreateDsdCorpusCore — rollback', () => {
  it('drops only DSD objects', async () => {
    const sql = await sqlOf('down');
    const dropped = [...sql.matchAll(/DROP TABLE IF EXISTS "([a-z_]+)"/gi)].map((m) => m[1]);
    expect(dropped.sort()).toEqual([...DSD_TABLES].sort());
    expect(sql).not.toMatch(/DROP DATABASE|DROP SCHEMA/i);
  });

  it('drops the trigger functions it created', async () => {
    const sql = await sqlOf('down');
    for (const fn of [
      'dsd_provenance_append_only',
      'dsd_reject_published_mutation',
      'dsd_reject_future_review',
    ]) {
      expect(sql).toContain(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
  });
});
