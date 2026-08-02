import { BackupCjkTranslations1721402350000 } from './1721402350000-BackupCjkTranslations';
import { assertSnapshotSafety } from './__tests__/assert-snapshot-safety';

async function collect(direction: 'up' | 'down') {
  const query = jest.fn().mockResolvedValue(undefined);
  const migration = new BackupCjkTranslations1721402350000();
  await migration[direction]({ query } as any);
  const statements = query.mock.calls.map(([sql]) => String(sql));
  return {
    statements,
    sql: statements.join('\n'),
    at: (pattern: RegExp) => statements.findIndex((sql) => pattern.test(sql)),
  };
}

describe('BackupCjkTranslations1721402350000', () => {
  it('takes a guarded and complete snapshot before translation', async () => {
    const { sql, at } = await collect('up');
    assertSnapshotSafety(sql);
    expect(at(/to_regclass/)).toBeLessThan(
      at(/CREATE TABLE "cleanup_backup_cjk_translations"/),
    );
    expect(sql).toContain("'definitions'");
    expect(sql).toContain("'examples'");
    expect(sql).toContain('incomplete CJK translation snapshot');
    expect(sql).toContain("'vi_contains_cjk' = ANY");
  });

  it('backs up every field overwritten by the translator', async () => {
    const { sql } = await collect('up');
    for (const column of [
      'text_value',
      'quality_flags',
      'review_status',
      'is_learner_visible',
    ]) {
      expect(sql).toContain(`"${column}"`);
    }
  });

  it('restores both tables and every overwritten field', async () => {
    const { sql } = await collect('down');
    expect(sql).toMatch(/UPDATE "definitions"/);
    expect(sql).toMatch(/UPDATE "examples"/);
    expect(sql).toContain('"definition_vi" = b."text_value"');
    expect(sql).toContain('"example_vi" = b."text_value"');
    expect(sql).toContain('"quality_flags" = b."quality_flags"');
    expect(sql).toContain('"review_status" = b."review_status"');
    expect(sql).toContain(
      '"is_learner_visible" = b."is_learner_visible"',
    );
    expect(sql).toContain(
      'DROP TABLE IF EXISTS "cleanup_backup_cjk_translations"',
    );
  });
});
