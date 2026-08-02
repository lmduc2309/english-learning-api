import { DedupeLegacyDictionaryRows1721402000000 } from './1721402000000-DedupeLegacyDictionaryRows';
import { assertSnapshotSafety } from './__tests__/assert-snapshot-safety';

function run(fn: (m: DedupeLegacyDictionaryRows1721402000000, r: any) => Promise<void>) {
  const query = jest.fn().mockResolvedValue(undefined);
  const migration = new DedupeLegacyDictionaryRows1721402000000();
  return fn(migration, { query }).then(() => {
    const statements = query.mock.calls.map(([s]) => String(s));
    return {
      statements,
      sql: statements.join('\n'),
      at: (re: RegExp) => statements.findIndex((s) => re.test(s)),
    };
  });
}

describe('DedupeLegacyDictionaryRows1721402000000', () => {
  it('backs up rows before deleting and keeps the lowest id', async () => {
    const { sql, at } = await run((m, r) => m.up(r));

    // Backup must precede any DELETE.
    const backupAt = sql.indexOf('cleanup_backup_definitions');
    const deleteAt = sql.search(/DELETE\s+FROM\s+"?definitions/i);
    expect(backupAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(backupAt);

    expect(sql).toContain('min("id")');
    expect(sql).toContain('UQ_definitions_word_text');
    expect(sql).toContain('UQ_pronunciations_word_accent_ipa');
    // example_en reaches 5171 bytes, past the btree limit, so digest the value.
    expect(sql).toContain('md5("example_en")');
    expect(sql).toContain('UQ_examples_definition_digest');
    // The key MUST include the Vietnamese, or 1223 distinct translations are lost.
    expect(sql).toContain(`md5(COALESCE("example_vi", ''))`);
    expect(sql).toContain('cleanup_review_example_vi_conflicts');
    // Never make legacy rows visible.
    expect(sql).not.toMatch(/is_learner_visible\s*=\s*true/i);

    // No IF NOT EXISTS / ON CONFLICT on any snapshot; guard precedes creation.
    assertSnapshotSafety(sql);

    // examples.definition_id is ON DELETE CASCADE: examples must be backed up
    // and remapped off the doomed definitions before anything is deleted.
    expect(at(/cleanup_backup_examples/)).toBeLessThan(
      at(/UPDATE "examples"[\s\S]*SET "definition_id"/),
    );
    expect(at(/UPDATE "examples"[\s\S]*SET "definition_id"/)).toBeLessThan(
      at(/DELETE\s+FROM\s+"examples"/),
    );
    expect(at(/DELETE\s+FROM\s+"examples"/)).toBeLessThan(
      at(/DELETE\s+FROM\s+"definitions"/),
    );

    // The backup must be topped up with rows the dedupe will remove that are
    // NOT attached to a remapped definition. Without this, rollback silently
    // restores a short examples table (15 rows on the live corpus).
    const topUpAt = at(/INSERT INTO "cleanup_backup_examples"[\s\S]*cleanup_example_keep/);
    expect(topUpAt).toBeGreaterThan(-1);
    expect(topUpAt).toBeLessThan(at(/DELETE\s+FROM\s+"examples"/));
  });

  it('restores deleted rows and drops constraints on rollback', async () => {
    const { sql, at } = await run((m, r) => m.down(r));

    expect(sql).toContain('DROP INDEX IF EXISTS "UQ_definitions_word_text"');
    expect(sql).toContain('INSERT INTO "definitions"');
    expect(sql).toContain('cleanup_backup_definitions');

    // Parent rows must return before their examples, or the FK rejects them.
    expect(at(/INSERT INTO "definitions"/)).toBeLessThan(at(/INSERT INTO "examples"/));

    // All three sequences advance, because explicit ids were re-inserted.
    for (const t of ['definitions', 'examples', 'pronunciations']) {
      expect(sql).toContain(`setval(pg_get_serial_sequence('${t}','id')`);
    }

    // Task 3 created the report table, so a true inverse drops it. Without
    // this, the existence check blocks any revert-then-retry.
    expect(sql).toContain('DROP TABLE IF EXISTS "cleanup_review_example_vi_conflicts"');
  });
});
