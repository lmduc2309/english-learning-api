import { RecomputeLegacyQualityFlags1721402400000 } from './1721402400000-RecomputeLegacyQualityFlags';
import { assertSnapshotSafety } from './__tests__/assert-snapshot-safety';

async function collect(direction: 'up' | 'down') {
  const query = jest.fn().mockResolvedValue(undefined);
  const migration = new RecomputeLegacyQualityFlags1721402400000();
  await migration[direction]({ query } as any);
  const statements = query.mock.calls.map(([sql]) => String(sql));
  return { statements, sql: statements.join('\n') };
}

describe('RecomputeLegacyQualityFlags1721402400000', () => {
  it('guards and verifies the complete snapshot before mutation', async () => {
    const { statements, sql } = await collect('up');
    assertSnapshotSafety(sql);
    const at = (pattern: RegExp) =>
      statements.findIndex((statement) => pattern.test(statement));
    expect(at(/to_regclass/)).toBeLessThan(
      at(/CREATE TABLE "cleanup_backup_quality_flags"/),
    );
    expect(at(/incomplete flag snapshot/)).toBeLessThan(
      at(/UPDATE "definitions" SET "quality_flags"/),
    );
  });

  it('rebuilds every legacy flag and preserves the reference-only gate', async () => {
    const { sql } = await collect('up');
    for (const flag of [
      'empty_definition',
      'missing_vi',
      'vi_contains_cjk',
      'vi_equals_en',
      'raw_markup',
      'example_too_long',
    ]) {
      expect(sql).toContain(flag);
    }
    expect(sql).not.toMatch(/is_learner_visible\s*=\s*true/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+"?(definitions|examples)/i);
    expect(sql).toContain(String.raw`\(`);
    expect(sql).toContain(String.raw`\.?$`);
  });

  it('restores both prior flag arrays', async () => {
    const { sql } = await collect('down');
    expect(sql).toMatch(/UPDATE "definitions"/);
    expect(sql).toMatch(/UPDATE "examples"/);
    expect(sql).toContain('b."quality_flags"');
    expect(sql).toContain(
      'DROP TABLE IF EXISTS "cleanup_backup_quality_flags"',
    );
  });
});
