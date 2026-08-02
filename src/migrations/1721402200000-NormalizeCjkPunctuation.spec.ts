import { NormalizeCjkPunctuation1721402200000 } from './1721402200000-NormalizeCjkPunctuation';
import { assertSnapshotSafety } from './__tests__/assert-snapshot-safety';

function collect(fn: (m: NormalizeCjkPunctuation1721402200000, r: any) => Promise<void>) {
  const query = jest.fn().mockResolvedValue(undefined);
  const migration = new NormalizeCjkPunctuation1721402200000();
  return fn(migration, { query }).then(() => {
    const statements = query.mock.calls.map(([s]) => String(s));
    return {
      statements,
      sql: statements.join('\n'),
      at: (re: RegExp) => statements.findIndex((s) => re.test(s)),
    };
  });
}

describe('NormalizeCjkPunctuation1721402200000', () => {
  it('guards its snapshot unconditionally', async () => {
    const { sql, at } = await collect((m, r) => m.up(r));
    assertSnapshotSafety(sql);
    // The guard must precede the CREATE, not merely coexist with it.
    expect(at(/to_regclass/)).toBeLessThan(
      at(/CREATE TABLE "cleanup_backup_cjk_punctuation"/),
    );
  });

  it('only touches rows without ideographs and clears the flag conditionally', async () => {
    const { sql } = await collect((m, r) => m.up(r));

    // Ideograph ranges must be EXCLUDED, using codepoints not literals.
    expect(sql).toContain('chr(19968)'); // U+4E00
    expect(sql).toContain('chr(40959)'); // U+9FFF
    expect(sql).toMatch(/!~/);
    expect(sql).toContain('translate(');
    expect(sql).toContain('chr(12290)'); // U+3002 ideographic full stop
    expect(sql).toContain(`array_remove("quality_flags", 'vi_contains_cjk')`);
    expect(sql).not.toMatch(/=\s*NULL/i);
    expect(sql).not.toMatch(/is_learner_visible\s*=\s*true/i);

    // The flag may only be cleared conditionally, and the condition must test
    // the FULL flag range - not just the ideograph subset used to select rows.
    expect(sql).toMatch(
      /CASE\s+WHEN[\s\S]*?array_remove\("quality_flags", 'vi_contains_cjk'\)[\s\S]*?END/i,
    );
    expect(sql).toContain('chr(65280)'); // U+FF00, fullwidth-forms lower bound
    expect(sql).toContain('chr(65519)'); // U+FFEF, fullwidth-forms upper bound
    expect(sql).toContain('chr(12351)'); // U+303F, CJK-punctuation upper bound

    // An unconditional clear is the specific bug this guards against.
    expect(sql).not.toMatch(
      /SET[\s\S]*?"quality_flags"\s*=\s*array_remove\("quality_flags", 'vi_contains_cjk'\)\s*\n\s*WHERE/i,
    );
  });

  it('releases the example digest index around the rewrite', async () => {
    const { at } = await collect((m, r) => m.up(r));
    // Normalizing example_vi can collide under UQ_examples_definition_digest,
    // which includes md5(example_vi). The index must be down for the UPDATE
    // and the collapse, then restored.
    expect(at(/DROP INDEX IF EXISTS "UQ_examples_definition_digest"/)).toBeLessThan(
      at(/UPDATE "examples"/),
    );
    expect(at(/INSERT INTO "cleanup_backup_cjk_punct_examples_deleted"/)).toBeLessThan(
      at(/DELETE FROM "examples" e/),
    );
    expect(at(/DELETE FROM "examples" e/)).toBeLessThan(
      at(/CREATE UNIQUE INDEX "UQ_examples_definition_digest"/),
    );
  });

  it('restores original text and collapsed rows on rollback', async () => {
    const { sql, at } = await collect((m, r) => m.down(r));
    expect(sql).toContain('cleanup_backup_cjk_punctuation');
    expect(sql).toContain('cleanup_backup_cjk_punct_examples_deleted');
    // Restoring pre-normalization text reintroduces the colliding digests, so
    // the index must be released first and rebuilt after.
    expect(at(/DROP INDEX IF EXISTS "UQ_examples_definition_digest"/)).toBeLessThan(
      at(/INSERT INTO "examples"/),
    );
    // Collapsed rows were snapshotted post-normalization, so they must be
    // re-inserted BEFORE the text restore, or the restore skips them and the
    // index rebuild hits the original digest collision.
    expect(at(/INSERT INTO "examples"/)).toBeLessThan(
      at(/UPDATE "examples" e\s+SET "example_vi" = b\."text_value"/),
    );
    expect(at(/UPDATE "examples" e\s+SET "example_vi" = b\."text_value"/)).toBeLessThan(
      at(/CREATE UNIQUE INDEX "UQ_examples_definition_digest"/),
    );
    expect(sql).toContain(`setval(pg_get_serial_sequence('examples','id')`);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+"definitions"/i);
  });
});
