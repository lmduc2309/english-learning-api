import { prepareBatch } from './generate';
import { estimateBatchBudget, validatePreparedBatch } from './batch';

const row = {
  dsd_entry_id: '11111111-1111-4111-8111-111111111111',
  headword: 'rehearse',
  part_of_speech_expectation: 'verb',
  dsd_priority: '1',
  dsd_band: 'core',
  product_rationale: 'Useful for study.',
  author_contributor_id: 'DSD-O-001',
  authored_date: '2026-08-10',
  inventory_evidence_id: 'EV-INV-TEST',
  declaration_id: 'DSD-DECL-TEST',
};

describe('direct OpenAI Batch submission guards', () => {
  it('accepts a deterministic prepared batch', () => {
    const prepared = prepareBatch([row], 'DSD-CAL-0001', 'gpt-5.6-terra', {
      type: 'object', additionalProperties: false,
    });
    expect(validatePreparedBatch(prepared.jsonl, prepared.manifest, 50)).toEqual([]);
  });

  it('rejects changed bytes, router IDs, and request ceilings', () => {
    const prepared = prepareBatch([row], 'DSD-CAL-0001', 'gpt-5.6-terra', {
      type: 'object', additionalProperties: false,
    });
    expect(validatePreparedBatch(prepared.jsonl + ' ', prepared.manifest, 50).join(' '))
      .toMatch(/SHA-256/);
    const routed = prepared.jsonl.replace('gpt-5.6-terra', 'openai/gpt-5.6-terra');
    const routedManifest = {
      ...prepared.manifest,
      requested_model: 'openai/gpt-5.6-terra',
      jsonl_sha256: require('crypto').createHash('sha256').update(routed).digest('hex'),
    };
    expect(validatePreparedBatch(routed, routedManifest, 50).join(' ')).toMatch(/router/);
    expect(validatePreparedBatch(prepared.jsonl, prepared.manifest, 0).join(' '))
      .toMatch(/exceeds configured maximum/);
  });

  it('estimates worst-case tokens and cost before upload', () => {
    const prepared = prepareBatch([row], 'DSD-CAL-0001', 'gpt-5.6-terra', {
      type: 'object', additionalProperties: false,
    });
    const estimate = estimateBatchBudget(prepared.jsonl, {
      inputMicrousdPerMtok: 1_000_000,
      outputMicrousdPerMtok: 2_000_000,
    });
    expect(estimate.estimatedInputTokens).toBeGreaterThan(0);
    expect(estimate.maximumOutputTokens).toBe(700);
    expect(estimate.estimatedMaxCostMicrousd).toBeGreaterThan(1_400);
  });
});
