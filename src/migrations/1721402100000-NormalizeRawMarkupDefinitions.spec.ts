import { NormalizeRawMarkupDefinitions1721402100000 } from './1721402100000-NormalizeRawMarkupDefinitions';
import { assertSnapshotSafety } from './__tests__/assert-snapshot-safety';

function collect(fn: (m: NormalizeRawMarkupDefinitions1721402100000, r: any) => Promise<void>) {
  const query = jest.fn().mockResolvedValue(undefined);
  const migration = new NormalizeRawMarkupDefinitions1721402100000();
  return fn(migration, { query }).then(() => {
    const statements = query.mock.calls.map(([s]) => String(s));
    return {
      statements,
      sql: statements.join('\n'),
      at: (re: RegExp) => statements.findIndex((s) => re.test(s)),
    };
  });
}

describe('NormalizeRawMarkupDefinitions1721402100000', () => {
  it('stages the rewrite and never updates definition_en under the index', async () => {
    const { sql, at } = await collect((m, r) => m.up(r));

    // Stage first, and back up before anything destructive.
    expect(sql).toContain('cleanup_definition_markup_stage');
    expect(at(/CREATE TABLE "cleanup_definition_markup_stage"/)).toBeLessThan(
      at(/DROP INDEX IF EXISTS "UQ_definitions_word_text"/),
    );
    expect(at(/INSERT INTO "cleanup_backup_examples_markup"/)).toBeLessThan(
      at(/UPDATE "examples" e\s+SET "definition_id"/),
    );

    // Cascade-safe ordering: remap examples -> delete examples -> delete definitions.
    expect(at(/UPDATE "examples" e\s+SET "definition_id"/)).toBeLessThan(
      at(/DELETE FROM "examples" e/),
    );
    expect(at(/DELETE FROM "examples" e/)).toBeLessThan(at(/DELETE FROM "definitions"/));

    // definition_en may only be written while the unique index is dropped.
    expect(at(/DROP INDEX IF EXISTS "UQ_definitions_word_text"/)).toBeLessThan(
      at(/SET "definition_en" = s\.normalized_en/),
    );
    expect(at(/SET "definition_en" = s\.normalized_en/)).toBeLessThan(
      at(/CREATE UNIQUE INDEX "UQ_definitions_word_text"/),
    );

    // Iterative normalizer: one regexp_replace cannot clear 18 pipes per group.
    expect(sql).toMatch(/LOOP/i);
    expect(sql).toContain('EXIT WHEN out = prev');
    expect(sql).toContain(String.raw`\(([^)|]*)\|`);
    expect(sql).toContain('&nbsp;');
    expect(sql).toContain('thumb|');

    // Example uniqueness must retain distinct Vietnamese.
    expect(sql).toContain(`md5(COALESCE("example_vi", ''))`);

    // Snapshot discipline.
    assertSnapshotSafety(sql);

    expect(sql).toContain(`array_remove("quality_flags", 'raw_markup')`);
    expect(sql).not.toMatch(/is_learner_visible\s*=\s*true/i);

    // The review report is rebuilt, not appended; stale example_ids must not survive.
    expect(at(/DELETE FROM "cleanup_review_example_vi_conflicts"/)).toBeLessThan(
      at(/INSERT INTO "cleanup_review_example_vi_conflicts"/),
    );
  });

  it('restores text, deleted rows and sequences on rollback', async () => {
    const { sql, at } = await collect((m, r) => m.down(r));

    expect(sql).toContain('cleanup_backup_definitions_markup');
    expect(sql).toContain('cleanup_backup_examples_markup');
    expect(sql).toContain('INSERT INTO "definitions"');

    // Parent rows must return before their examples, or the FK rejects them.
    expect(at(/INSERT INTO "definitions"/)).toBeLessThan(at(/INSERT INTO "examples"/));

    // Explicit ids were inserted, so both sequences must be advanced.
    expect(sql).toContain(`setval(pg_get_serial_sequence('definitions','id')`);
    expect(sql).toContain(`setval(pg_get_serial_sequence('examples','id')`);
  });
});
