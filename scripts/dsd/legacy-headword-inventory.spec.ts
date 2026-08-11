import { buildLegacyHeadwordRows } from './legacy-headword-inventory';
import * as fs from 'fs';

describe('legacy headword-only inventory', () => {
  it('normalizes, sorts, assigns fresh identities, and requires POS inference', () => {
    const result = buildLegacyHeadwordRows(['Zoo', 'apple', 'Baker'], '2026-08-11');
    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => row.headword)).toEqual(['apple', 'Baker', 'Zoo']);
    expect(result.rows.every((row) => row.part_of_speech_expectation === 'infer')).toBe(true);
    expect(result.rows.every((row) => row.inventory_evidence_id.includes('HEADWORDS-ONLY'))).toBe(true);
  });
  it('fails closed on normalized duplicates', () => {
    expect(buildLegacyHeadwordRows(['Word', ' word '], '2026-08-11').errors).toContain("duplicate normalized headword 'word'");
  });
  it('queries only the one-column compliance view', () => {
    const source = fs.readFileSync(require.resolve('./legacy-headword-inventory'), 'utf8');
    expect(source).toContain('SELECT headword FROM dsd_compliance.headword_inventory_input');
    expect(source).not.toMatch(/SELECT[^'\n]*(definition|translation|example|rank|word_id)/i);
    expect(source).toContain("result.fields.length !== 1");
  });
});
