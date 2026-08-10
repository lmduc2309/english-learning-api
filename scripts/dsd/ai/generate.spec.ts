import { InventoryRow } from '../inventory';
import { calculateCostMicrousd, prepareBatch } from './generate';

const rows: InventoryRow[] = [{
  dsd_entry_id: '11111111-1111-4111-8111-111111111111',
  headword: 'rehearse',
  part_of_speech_expectation: 'verb',
  dsd_priority: '1',
  dsd_band: 'core',
  product_rationale: 'Useful for study and performance contexts.',
  author_contributor_id: 'DSD-O-001',
  authored_date: '2026-08-10',
  inventory_evidence_id: 'EV-INV-TEST',
  declaration_id: 'DSD-DECL-TEST',
}];

describe('DSD OpenAI generation preparation', () => {
  it('produces deterministic JSONL and manifests', () => {
    const first = prepareBatch(rows, 'DSD-CAL-0001', 'gpt-5.6-terra', {
      type: 'object', additionalProperties: false,
    });
    const second = prepareBatch(rows, 'DSD-CAL-0001', 'gpt-5.6-terra', {
      type: 'object', additionalProperties: false,
    });
    expect(first).toEqual(second);
    expect(first.manifest).toMatchObject({
      request_count: 1,
      legacy_input_used: false,
      endpoint: '/v1/responses',
    });
    expect(first.manifest.jsonl_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('calculates micro-USD from explicit per-million-token prices', () => {
    expect(calculateCostMicrousd(1_000, 500, {
      inputMicrousdPerMtok: 2_000_000,
      outputMicrousdPerMtok: 12_000_000,
    })).toBe(8_000);
  });
});
