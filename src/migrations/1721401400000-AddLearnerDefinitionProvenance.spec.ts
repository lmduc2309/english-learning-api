import { AddLearnerDefinitionProvenance1721401400000 } from './1721401400000-AddLearnerDefinitionProvenance';

describe('AddLearnerDefinitionProvenance1721401400000', () => {
  it('adds source version and artifact digest without fabricating legacy values', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new AddLearnerDefinitionProvenance1721401400000();

    await migration.up({ query } as any);

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('"definition_source_version" varchar(40)');
    expect(sql).toContain('"definition_source_artifact_sha256" varchar(64)');
    expect(sql).toContain('CHK_learner_sense_definition_provenance');
    expect(sql).toContain('CHK_learner_sense_published_definition_provenance');
    expect(sql).toContain('"definition_source_artifact_sha256" IS NOT NULL');
    expect(sql).toContain("'^[0-9a-f]{64}$'");
    expect(sql).toContain('NOT VALID');
    expect(sql).toContain(
      'VALIDATE CONSTRAINT "CHK_learner_sense_definition_provenance"',
    );
    expect(sql).not.toContain(
      'VALIDATE CONSTRAINT "CHK_learner_sense_published_definition_provenance"',
    );
    expect(sql).not.toMatch(/UPDATE\s+"learner_senses"/i);
  });

  it('removes only the provenance constraints and columns on rollback', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new AddLearnerDefinitionProvenance1721401400000();

    await migration.down({ query } as any);

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS "CHK_learner_sense_published_definition_provenance"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "definition_source_artifact_sha256"');
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
  });
});
