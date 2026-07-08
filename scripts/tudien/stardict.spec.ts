import { parseIfo, parseIdx } from './stardict';

describe('parseIfo', () => {
  it('extracts key fields', () => {
    const ifo = [
      "StarDict's dict ifo file",
      'version=3.0.0',
      'bookname=tudien Anh-Việt tổng hợp (en-vi)',
      'wordcount=235561',
      'idxfilesize=4751217',
      'sametypesequence=h',
    ].join('\n');
    const info = parseIfo(ifo);
    expect(info.version).toBe('3.0.0');
    expect(info.wordcount).toBe(235561);
    expect(info.sametypesequence).toBe('h');
    expect(info.bookname).toContain('Anh-Việt');
  });
});

describe('parseIdx', () => {
  it('reads null-terminated word + 4-byte BE offset + 4-byte BE size records', () => {
    // "ab" @ offset 0 size 5 ; "cd" @ offset 5 size 3
    const rec = (word: string, off: number, size: number) => {
      const w = Buffer.from(word, 'utf8');
      const nums = Buffer.alloc(9); // \0 + off(4) + size(4)
      nums.writeUInt8(0, 0);
      nums.writeUInt32BE(off, 1);
      nums.writeUInt32BE(size, 5);
      return Buffer.concat([w, nums]);
    };
    const buf = Buffer.concat([rec('ab', 0, 5), rec('cd', 5, 3)]);
    expect(parseIdx(buf)).toEqual([
      { word: 'ab', offset: 0, size: 5 },
      { word: 'cd', offset: 5, size: 3 },
    ]);
  });

  it('preserves UTF-8 headwords', () => {
    const w = Buffer.from('cà phê', 'utf8');
    const nums = Buffer.alloc(9);
    nums.writeUInt32BE(10, 1);
    nums.writeUInt32BE(20, 5);
    const [r] = parseIdx(Buffer.concat([w, nums]));
    expect(r).toEqual({ word: 'cà phê', offset: 10, size: 20 });
  });
});
