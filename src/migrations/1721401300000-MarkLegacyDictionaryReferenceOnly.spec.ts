import { MarkLegacyDictionaryReferenceOnly1721401300000 } from './1721401300000-MarkLegacyDictionaryReferenceOnly';

describe('MarkLegacyDictionaryReferenceOnly1721401300000', () => {
  it('makes both legacy tables reference-only without deleting their rows', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new MarkLegacyDictionaryReferenceOnly1721401300000();

    await migration.up({ query } as any);

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain(
      'ALTER COLUMN "is_learner_visible" SET DEFAULT false',
    );
    expect(sql).toContain('CHK_definitions_reference_only');
    expect(sql).toContain('CHK_examples_reference_only');
    expect(sql).toContain(
      'UPDATE "definitions" SET "is_learner_visible" = false WHERE "is_learner_visible" = true',
    );
    expect(sql).toContain(
      'UPDATE "examples" SET "is_learner_visible" = false WHERE "is_learner_visible" = true',
    );
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
  });

  it('does not re-enable legacy rows during rollback', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new MarkLegacyDictionaryReferenceOnly1721401300000();

    await migration.down({ query } as any);

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).not.toMatch(/SET DEFAULT true/i);
    expect(sql).not.toMatch(/SET\s+"is_learner_visible"\s*=\s*true/i);
  });
});
