import { DedupeWordPartOfSpeech1721402300000 } from './1721402300000-DedupeWordPartOfSpeech';
import { assertSnapshotSafety } from './__tests__/assert-snapshot-safety';

function collect(fn: (m: DedupeWordPartOfSpeech1721402300000, r: any) => Promise<void>) {
  const query = jest.fn().mockResolvedValue(undefined);
  const migration = new DedupeWordPartOfSpeech1721402300000();
  return fn(migration, { query }).then(() => {
    const statements = query.mock.calls.map(([s]) => String(s));
    return {
      statements,
      sql: statements.join('\n'),
      at: (re: RegExp) => statements.findIndex((s) => re.test(s)),
    };
  });
}

describe('DedupeWordPartOfSpeech1721402300000', () => {
  it('guards its snapshot unconditionally', async () => {
    const { sql, at } = await collect((m, r) => m.up(r));
    assertSnapshotSafety(sql);
    expect(at(/to_regclass/)).toBeLessThan(
      at(/CREATE TABLE "cleanup_backup_words_pos"/),
    );
  });

  it('dedupes while preserving first-occurrence order', async () => {
    const { sql } = await collect((m, r) => m.up(r));
    expect(sql).toContain('cleanup_backup_words_pos');
    // ORDER BY on the unnested ordinality is what preserves original order.
    expect(sql).toContain('WITH ORDINALITY');
    expect(sql).toContain('min(ord)');
    expect(sql).toContain('cardinality');
    // Only rows that actually contain repeats may be touched.
    expect(sql).toMatch(/cardinality\("part_of_speech"\)\s*<>\s*cardinality/);
  });

  it('restores original arrays on rollback', async () => {
    const { sql } = await collect((m, r) => m.down(r));
    expect(sql).toContain('cleanup_backup_words_pos');
    expect(sql).toMatch(/UPDATE\s+"words"/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+"words"/i);
  });
});
