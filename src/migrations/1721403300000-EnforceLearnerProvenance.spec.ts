import { EnforceLearnerProvenance1721403300000 } from './1721403300000-EnforceLearnerProvenance';

function collect(fn: (m: EnforceLearnerProvenance1721403300000, r: any) => Promise<void>) {
  const query = jest.fn().mockResolvedValue(undefined);
  const migration = new EnforceLearnerProvenance1721403300000();
  return fn(migration, { query }).then(() =>
    query.mock.calls.map(([s]) => String(s)).join('\n'),
  );
}

describe('EnforceLearnerProvenance1721403300000', () => {
  it('validates the provenance constraint that shipped NOT VALID', async () => {
    const sql = await collect((m, r) => m.up(r));
    // Both learner tables are empty, so validating is free and makes the
    // constraint honest rather than advisory.
    expect(sql).toContain(
      'VALIDATE CONSTRAINT "CHK_learner_sense_published_definition_provenance"',
    );
  });

  it('requires a source URL on published senses', async () => {
    const sql = await collect((m, r) => m.up(r));
    expect(sql).toContain('CHK_learner_sense_published_source_url');
    expect(sql).toContain('definition_source_url');
    // Drafts must stay unconstrained so curation can proceed.
    expect(sql).toMatch(/status[^)]*<>\s*'published'/i);
  });

  it('blocks publishing a sense with no approved Vietnamese translation', async () => {
    const sql = await collect((m, r) => m.up(r));
    // A CHECK cannot span tables, so this invariant needs a trigger.
    expect(sql).toMatch(/CREATE\s+(CONSTRAINT\s+)?TRIGGER/i);
    expect(sql).toContain('learner_sense_publish_requires_approved_translation');
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(sql).toContain(`'approved'`);
    expect(sql).toContain(`'vi'`);
  });

  it('never fabricates provenance for existing rows', async () => {
    const sql = await collect((m, r) => m.up(r));
    expect(sql).not.toMatch(/UPDATE\s+"learner_/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+"learner_/i);
  });

  it('drops only what it added on rollback', async () => {
    const sql = await collect((m, r) => m.down(r));
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS "CHK_learner_sense_published_source_url"');
    expect(sql).toMatch(/DROP\s+TRIGGER\s+IF\s+EXISTS/i);
    expect(sql).toMatch(/DROP\s+FUNCTION\s+IF\s+EXISTS/i);
    expect(sql).not.toMatch(/DELETE|TRUNCATE/i);
  });
});
