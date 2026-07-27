import { parseEntry, cleanText, stripSyllableDots } from './parse-entry';
import { CAPACITOR, HAPPY, THE } from './__fixtures__/entries';

describe('cleanText', () => {
  it('strips tags, decodes entities, collapses whitespace', () => {
    expect(cleanText('<b>1.&nbsp;&nbsp;</b>cái tụ điện')).toBe('1. cái tụ điện');
  });
});

describe('stripSyllableDots', () => {
  it('removes the middot and zero-width joiner', () => {
    expect(stripSyllableDots('cap·aci·tor')).toBe('capacitor');
  });
});

describe('parseEntry', () => {
  it('parses a single-sense noun with no examples (capacitor)', () => {
    const e = parseEntry(CAPACITOR);
    expect(e.headword).toBe('capacitor');
    expect(e.posBlocks).toHaveLength(1); // synonym section excluded
    expect(e.posBlocks[0].vnPos).toBe('danh từ');
    expect(e.posBlocks[0].senses).toEqual(['cái tụ điện']);
    expect(e.posBlocks[0].examples).toEqual([]);
  });

  it('parses multiple numbered senses + examples, skips ★ idioms and excluded sections (happy)', () => {
    const e = parseEntry(HAPPY);
    expect(e.headword).toBe('happy');
    expect(e.posBlocks).toHaveLength(1); // "đồng nghĩa" + "nguồn gốc" excluded
    const b = e.posBlocks[0];
    expect(b.vnPos).toBe('tính từ');
    expect(b.senses).toHaveLength(5); // ★ idiom line is NOT a sense
    expect(b.senses[0]).toBe('vui sướng, vui lòng (một công thức xã giao)');
    expect(b.senses[4]).toBe('(từ lóng) bị choáng váng, bị ngây ngất (vì bom...)');
    expect(b.examples).toContainEqual({
      en: 'I shall be happy to accept your invitation',
      vi: 'tôi sung sướng nhận lời mời của ông',
    });
    expect(b.examples).toContainEqual({ en: 'a happy marriage', vi: 'một cuộc hôn nhân hạnh phúc' });
    expect(b.examples).toHaveLength(4);
  });

  it('parses multiple POS blocks incl. an example-only block (the)', () => {
    const e = parseEntry(THE);
    expect(e.headword).toBe('the');
    expect(e.posBlocks.map(b => b.vnPos)).toEqual(['mạo từ', 'trạng từ']);
    expect(e.posBlocks[0].senses).toHaveLength(2);
    expect(e.posBlocks[1].senses).toEqual([]); // trạng từ has an empty sense div
    expect(e.posBlocks[1].examples).toContainEqual({ en: 'so much the better', vi: 'càng tốt' });
  });
});
