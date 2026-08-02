import { NormalizeExampleMarkup1721403100000 } from './1721403100000-NormalizeExampleMarkup';
import { assertSnapshotSafety } from './__tests__/assert-snapshot-safety';

function collect(fn: (m: NormalizeExampleMarkup1721403100000, r: any) => Promise<void>) {
  const query = jest.fn().mockResolvedValue(undefined);
  const migration = new NormalizeExampleMarkup1721403100000();
  return fn(migration, { query }).then(() => {
    const statements = query.mock.calls.map(([s]) => String(s));
    return {
      sql: statements.join('\n'),
      at: (re: RegExp) => statements.findIndex((s) => re.test(s)),
    };
  });
}

describe('NormalizeExampleMarkup1721403100000', () => {
  it('releases the digest index around the rewrite', async () => {
    const { sql, at } = await collect((m, r) => m.up(r));

    assertSnapshotSafety(sql);

    // UQ_examples_definition_digest covers md5(example_en). Rewriting the
    // English collides exactly as the CJK punctuation migration did twice.
    expect(at(/DROP INDEX IF EXISTS "UQ_examples_definition_digest"/)).toBeLessThan(
      at(/SET "example_en"/),
    );
    expect(at(/SET "example_en"/)).toBeLessThan(
      at(/CREATE UNIQUE INDEX "UQ_examples_definition_digest"/),
    );

    // Iterative normalizer: one regexp_replace cannot clear nested pipes.
    expect(sql).toMatch(/LOOP/i);
    expect(sql).toContain('EXIT WHEN out = prev');
    expect(sql).toContain(String.raw`\(([^)|]*)\|`);
    expect(sql).toContain('&nbsp;');
    expect(sql).toContain(`array_remove("quality_flags", 'raw_markup')`);
    expect(sql).not.toMatch(/is_learner_visible\s*=\s*true/i);
  });

  it('backs up collapsed rows before deleting them', async () => {
    const { at } = await collect((m, r) => m.up(r));
    // Anything the rewrite turns into a duplicate must be recoverable.
    expect(at(/INSERT INTO "cleanup_backup_examples_markup_deleted"/)).toBeLessThan(
      at(/DELETE FROM "examples" e/),
    );
  });

  it('restores original text and collapsed rows on rollback', async () => {
    const { sql, at } = await collect((m, r) => m.down(r));

    expect(sql).toContain('cleanup_backup_examples_markup_text');
    expect(sql).toContain('cleanup_backup_examples_markup_deleted');
    // Re-inserting rows snapshotted post-rewrite reproduces the collision the
    // collapse resolved, so they must go back before the text is restored.
    expect(at(/INSERT INTO "examples"/)).toBeLessThan(
      at(/SET "example_en" = b\."example_en"/),
    );
    expect(sql).toContain(`setval(pg_get_serial_sequence('examples','id')`);
  });
});
