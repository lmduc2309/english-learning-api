import { AddDsdSimilarityAudit1785628900000 } from './1785628900000-AddDsdSimilarityAudit';

async function sqlOf(direction: 'up' | 'down'): Promise<string> {
  const query = jest.fn().mockResolvedValue(undefined);
  await new AddDsdSimilarityAudit1785628900000()[direction]({ query } as any);
  return query.mock.calls.map(([s]) => String(s)).join('\n');
}

describe('AddDsdSimilarityAudit — what it must not store', () => {
  it('has no column capable of holding legacy text', async () => {
    const sql = await sqlOf('up');
    for (const forbidden of [
      'legacy_text', 'matched_text', 'source_text', 'legacy_definition',
      'legacy_example', 'excerpt', 'snippet', 'rationale', 'notes', 'comment',
    ]) {
      expect(sql).not.toMatch(new RegExp(`"${forbidden}"`, 'i'));
    }
  });

  it('has no column capable of holding a legacy row identifier', async () => {
    const sql = await sqlOf('up');
    for (const forbidden of [
      'word_id', 'definition_id', 'example_id', 'legacy_id', 'source_definition_id',
      'source_sense_id', 'oewn_sense_id',
    ]) {
      expect(sql).not.toMatch(new RegExp(`"${forbidden}"`, 'i'));
    }
  });

  it('keeps only a digest of what was matched', async () => {
    const sql = await sqlOf('up');
    expect(sql).toMatch(/"legacy_digest"\s+char\(64\)/);
    expect(sql).toMatch(/CHK_dsd_similarity_legacy_digest/);
  });

  it('references no table at all, legacy or otherwise', async () => {
    // Referencing dsd_senses would be convenient and would also mean a
    // similarity row could not outlive a superseded revision it judged.
    expect(await sqlOf('up')).not.toMatch(/REFERENCES/i);
  });

  it('restricts the one free-shaped column to algorithm output', async () => {
    const sql = await sqlOf('up');
    expect(sql).toMatch(/CHK_dsd_similarity_scores_shape/);
    expect(sql).toMatch(/"component_scores" - ARRAY\[/);
  });
});

describe('AddDsdSimilarityAudit — release policy in the schema', () => {
  it('forbids clearing an exact match as independently authored', async () => {
    const sql = await sqlOf('up');
    expect(sql).toMatch(/CHK_dsd_similarity_exact_never_cleared/);
    expect(sql).toMatch(/"match_class" <> 'exact' OR "decision" <> 'independently_authored_cleared'/);
  });

  it('requires a signed, evidenced act for any manual decision', async () => {
    const sql = await sqlOf('up');
    const constraint = sql.match(/CHK_dsd_similarity_manual_clearance[\s\S]*?\)\s*\),/)![0];
    expect(constraint).toMatch(/"decided_by"/);
    expect(constraint).toMatch(/"decided_at"/);
    expect(constraint).toMatch(/"decision_evidence_id"/);
    expect(constraint).toMatch(/"decision_reason"/);
  });

  it('lets only a low result be cleared automatically', async () => {
    expect(await sqlOf('up')).toMatch(
      /"decision" <> 'clear' OR "match_class" = 'low'/,
    );
  });

  it('binds every result to the content and policy that produced it', async () => {
    const sql = await sqlOf('up');
    expect(sql).toMatch(/"content_sha256"/);
    expect(sql).toMatch(/"policy_sha256"/);
    expect(sql).toMatch(/"normalization_version"/);
    expect(sql).toMatch(/"algorithm_version"/);
    expect(sql).toMatch(/UQ_dsd_similarity_content_policy/);
  });
});

describe('AddDsdSimilarityAudit — immutability', () => {
  it('freezes the measurement while leaving the decision editable', async () => {
    const sql = await sqlOf('up');
    const fn = sql.match(/dsd_similarity_measurement_immutable[\s\S]*?\$fn\$;/)![0];
    for (const frozen of [
      'content_sha256', 'policy_sha256', 'component_scores', 'match_class',
      'legacy_digest', 'audited_by',
    ]) {
      expect(fn).toContain(`"${frozen}"`);
    }
    // The decision fields are the point of the update path.
    for (const editable of ['decision', 'decided_by', 'decision_evidence_id']) {
      expect(fn).not.toContain(`NEW."${editable}" IS DISTINCT`);
    }
  });

  it('fires on update', async () => {
    expect(await sqlOf('up')).toMatch(
      /CREATE TRIGGER "TRG_dsd_similarity_measurement_immutable"\s+BEFORE UPDATE/,
    );
  });
});

describe('AddDsdSimilarityAudit — grants', () => {
  it('lets the auditor write verdicts and the curator only read them', async () => {
    const sql = await sqlOf('up');
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE ON "dsd_similarity_results" TO dsd_auditor/);
    expect(sql).toMatch(/GRANT SELECT ON "dsd_similarity_results" TO dsd_curator/);
    expect(sql).not.toMatch(/INSERT[^;]*TO dsd_curator/);
  });

  it('grants nothing to the serving role', async () => {
    expect(await sqlOf('up')).not.toMatch(/TO dsd_app/);
  });
});

describe('AddDsdSimilarityAudit — down', () => {
  it('drops only what it created', async () => {
    const sql = await sqlOf('down');
    expect(sql).toMatch(/DROP TABLE IF EXISTS "dsd_similarity_results"/);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS dsd_similarity_measurement_immutable/);
    expect(sql).not.toMatch(/dsd_senses|dsd_entries/);
  });
});
