export interface VietnameseGlossCandidate {
  word: string;
  definitionVi: string;
  definitionEn: string;
  partOfSpeech: string;
  senseId: string;
  senseOrder: number;
  learnerRank?: number | null;
  sourcePriority?: number;
  dataSource?: 'curated' | 'raw_fallback';
  examples?: Array<{ en: string; vi: string }>;
}

export interface VietnameseGlossMatch {
  word: string;
  definition_vi: string;
  definition_en: string;
  part_of_speech: string;
  sense_id: string;
  score: number;
  data_source: 'curated' | 'raw_fallback';
  examples: Array<{ en: string; vi: string }>;
}

/**
 * Fold Vietnamese for lookup only. The original reviewed spelling is always
 * returned to clients. This makes "hoc" match "học" without weakening the
 * publication and approval gates used to select candidates.
 */
export function normalizeVietnameseSearch(value: string): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/đ/gu, 'd')
    .replace(/Đ/gu, 'D')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function scoreGloss(query: string, gloss: string): number {
  if (!query || !gloss) return 0;
  if (gloss === query) return 100;
  if (gloss.startsWith(`${query} `)) return 90;

  const glossTokens = gloss.split(' ');
  if (glossTokens.includes(query)) return 80;
  if (gloss.includes(query)) return 65;

  const queryTokens = query.split(' ').filter(Boolean);
  if (queryTokens.length > 1 && queryTokens.every((token) => glossTokens.includes(token))) {
    return 55;
  }
  return 0;
}

export function rankVietnameseGlosses(
  query: string,
  candidates: readonly VietnameseGlossCandidate[],
  limit = 12,
): VietnameseGlossMatch[] {
  const normalizedQuery = normalizeVietnameseSearch(query);
  if (!normalizedQuery || limit < 1) return [];

  return candidates
    .map((candidate) => ({
      candidate,
      score: scoreGloss(
        normalizedQuery,
        normalizeVietnameseSearch(candidate.definitionVi),
      ),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => (
      b.score - a.score
      || (a.candidate.sourcePriority ?? 1) - (b.candidate.sourcePriority ?? 1)
      || (a.candidate.learnerRank ?? Number.MAX_SAFE_INTEGER)
        - (b.candidate.learnerRank ?? Number.MAX_SAFE_INTEGER)
      || a.candidate.senseOrder - b.candidate.senseOrder
      || a.candidate.word.localeCompare(b.candidate.word, 'en')
    ))
    .slice(0, limit)
    .map(({ candidate, score }) => ({
      word: candidate.word,
      definition_vi: candidate.definitionVi,
      definition_en: candidate.definitionEn,
      part_of_speech: candidate.partOfSpeech,
      sense_id: candidate.senseId,
      score,
      data_source: candidate.dataSource || 'raw_fallback',
      examples: candidate.examples || [],
    }));
}
