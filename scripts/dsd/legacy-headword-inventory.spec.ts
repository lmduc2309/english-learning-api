import { buildLegacyHeadwordRows } from './legacy-headword-inventory';
import * as fs from 'fs';

describe('legacy headword-only inventory', () => {
  it('normalizes, sorts, assigns fresh identities, and requires POS inference', () => {
    const result = buildLegacyHeadwordRows(['Zoo', 'apple', 'Baker'], '2026-08-11');
    expect(result.quarantine).toEqual([]);
    expect(result.rows.map((row) => row.headword)).toEqual(['apple', 'Baker', 'Zoo']);
    expect(result.rows.every((row) => row.part_of_speech_expectation === 'infer')).toBe(true);
    expect(result.rows.every((row) => row.inventory_evidence_id.includes('HEADWORDS-ONLY'))).toBe(true);
  });
  it('quarantines normalized duplicates and non-lexical input', () => {
    const result = buildLegacyHeadwordRows(['Word', ' word ', '-ability'], '2026-08-11');
    expect(result.rows.map((row) => row.headword)).toEqual(['Word']);
    expect(result.quarantine.flatMap((entry) => entry.reasons).join(' ')).toContain("duplicate normalized headword 'word'");
    expect(result.quarantine.map((entry) => entry.headword)).toContain('-ability');
  });
  it('queries only the one-column compliance view', () => {
    const source = fs.readFileSync(require.resolve('./legacy-headword-inventory'), 'utf8');
    expect(source).toContain('SELECT headword FROM dsd_compliance.headword_inventory_input');
    expect(source).not.toMatch(/SELECT[^'\n]*(definition|translation|example|rank|word_id)/i);
    expect(source).toContain("result.fields.length !== 1");
  });
});
