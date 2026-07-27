// Vietnamese part-of-speech labels (as used by tudien) → English POS used in
// the `definitions.part_of_speech` column.
export const VN_POS_MAP: Record<string, string> = {
  'danh từ': 'noun',
  'động từ': 'verb',
  'tính từ': 'adjective',
  'trạng từ': 'adverb',
  'giới từ': 'preposition',
  'đại từ': 'pronoun',
  'mạo từ': 'determiner',
  'liên từ': 'conjunction',
  'thán từ': 'interjection',
  'số từ': 'numeral',
  'ngoại động từ': 'verb',
  'nội động từ': 'verb',
  'phó từ': 'adverb',
  'cảm thán': 'interjection',
};

// tudien reuses the "■" section marker for non-meaning sections; these must not
// be treated as POS/meaning blocks.
export const EXCLUDE_SECTIONS = new Set<string>([
  'đồng nghĩa/liên quan',
  'nguồn gốc từ',
  'cụm động từ',
  'thành ngữ',
  'viết tắt',
  'cụm từ',
  'tiền tố',
  'hậu tố',
]);

// Map a tudien POS label to an English POS, tolerating case, surrounding
// whitespace, and trailing irregular forms (e.g. "động từ ran, run") or
// comma/ampersand multi-POS labels (e.g. "tính từ, trạng từ").
export function mapVnPos(rawLabel: string): string | null {
  const label = rawLabel.trim().toLowerCase();
  for (const [vn, en] of Object.entries(VN_POS_MAP)) {
    if (label === vn) return en;
    if (label.startsWith(vn)) {
      const next = label[vn.length];
      if (next === ' ' || next === ',') return en;
    }
  }
  return null;
}
