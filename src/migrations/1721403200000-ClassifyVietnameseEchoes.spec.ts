import { ClassifyVietnameseEchoes1721403200000 } from './1721403200000-ClassifyVietnameseEchoes';
import { assertSnapshotSafety } from './__tests__/assert-snapshot-safety';

function collect(fn: (m: ClassifyVietnameseEchoes1721403200000, r: any) => Promise<void>) {
  const query = jest.fn().mockResolvedValue(undefined);
  const migration = new ClassifyVietnameseEchoes1721403200000();
  return fn(migration, { query }).then(() =>
    query.mock.calls.map(([s]) => String(s)).join('\n'),
  );
}

describe('ClassifyVietnameseEchoes1721403200000', () => {
  it('classifies without mutating any corpus text', async () => {
    const sql = await collect((m, r) => m.up(r));

    assertSnapshotSafety(sql);
    expect(sql).toContain('cleanup_review_vi_echoes');
    for (const kind of ['symbol_only', 'proper_noun_candidate', 'needs_translation']) {
      expect(sql).toContain(kind);
    }

    // This is a report. It must not touch corpus text or rows.
    expect(sql).not.toMatch(/UPDATE\s+"definitions"\s+SET\s+"definition_vi"/i);
    expect(sql).not.toMatch(/UPDATE\s+"examples"\s+SET\s+"example_vi"/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+"(definitions|examples)"/i);
    expect(sql).not.toMatch(/array_remove\("quality_flags"/);
  });

  it('covers both tables', async () => {
    const sql = await collect((m, r) => m.up(r));
    expect(sql).toMatch(/FROM "definitions"/);
    expect(sql).toMatch(/FROM "examples"/);
  });

  it('drops only its own report on rollback', async () => {
    const sql = await collect((m, r) => m.down(r));
    expect(sql).toContain('DROP TABLE IF EXISTS "cleanup_review_vi_echoes"');
    expect(sql).not.toMatch(/UPDATE|DELETE FROM "(definitions|examples)"/i);
  });
});
