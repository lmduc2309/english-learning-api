import { mapVnPos, EXCLUDE_SECTIONS } from './pos-map';

describe('mapVnPos', () => {
  it('maps core Vietnamese parts of speech to English', () => {
    expect(mapVnPos('danh từ')).toBe('noun');
    expect(mapVnPos('động từ')).toBe('verb');
    expect(mapVnPos('tính từ')).toBe('adjective');
    expect(mapVnPos('trạng từ')).toBe('adverb');
    expect(mapVnPos('mạo từ')).toBe('determiner');
  });

  it('matches when the label has trailing irregular forms', () => {
    // e.g. tudien writes "động từ ran, run" for irregular verbs
    expect(mapVnPos('động từ ran, run')).toBe('verb');
  });

  it('is case/whitespace tolerant', () => {
    expect(mapVnPos('  Danh Từ  ')).toBe('noun');
  });

  it('returns null for unknown labels', () => {
    expect(mapVnPos('đồng nghĩa/liên quan')).toBeNull();
    expect(mapVnPos('xyz')).toBeNull();
  });

  it('lists the non-meaning sections to exclude', () => {
    expect(EXCLUDE_SECTIONS.has('đồng nghĩa/liên quan')).toBe(true);
    expect(EXCLUDE_SECTIONS.has('nguồn gốc từ')).toBe(true);
  });
});
