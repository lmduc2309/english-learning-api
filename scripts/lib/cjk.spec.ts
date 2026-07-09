import { containsCjk } from './cjk';

describe('containsCjk', () => {
  it('flags Chinese ideographs', () => {
    expect(containsCjk('一种动物以两种食物为食')).toBe(true);
  });

  it('flags mixed Vietnamese + Chinese glosses (real bad rows)', () => {
    expect(containsCjk('(Mỹ,俚语,幽默)一种大型食用和猎物黄尾鱼')).toBe(true);
    expect(containsCjk('(主要在_, 生物学)一种动物以两种食物为食')).toBe(true);
  });

  it('flags fullwidth CJK punctuation', () => {
    expect(containsCjk('例子，测试')).toBe(true);
  });

  it('does NOT flag valid Vietnamese', () => {
    expect(containsCjk('sông A-ma-zôn (Nam-Mỹ)')).toBe(false);
    expect(containsCjk('cái tụ điện')).toBe(false);
    expect(containsCjk('(tên khoa học của loài côn trùng lớp)')).toBe(false);
  });

  it('does NOT flag plain English', () => {
    expect(containsCjk('a large edible game fish')).toBe(false);
  });

  it('handles null/undefined/empty', () => {
    expect(containsCjk(null)).toBe(false);
    expect(containsCjk(undefined)).toBe(false);
    expect(containsCjk('')).toBe(false);
  });

  it('does NOT flag Korean Hangul or other non-CJK scripts (confusable-range regression)', () => {
    expect(containsCjk('한글')).toBe(false); // Korean, U+AC00 block
    expect(containsCjk('ꀀ')).toBe(false); // Yi syllable
  });

  it('flags a genuine CJK Compatibility Ideograph (U+F900)', () => {
    expect(containsCjk('豈')).toBe(true);
  });
});
