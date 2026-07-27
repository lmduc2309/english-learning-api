export interface CurationReviewExample {
  en: string;
  vi: string;
}

export interface CurationReviewPronunciation {
  accent: string;
  ipa: string;
  review_status?: string;
  source: string;
  source_url?: string;
  source_license: string;
}

export interface CurationReviewRow {
  word: string;
  learner_rank?: number;
  sense_order: number;
  sense_key: string;
  part_of_speech: string;
  definition_en: string;
  definition_vi: string;
  examples?: CurationReviewExample[];
  pronunciations?: CurationReviewPronunciation[];
  definition_source?: string;
  definition_source_version?: string;
  definition_source_artifact_sha256?: string;
  cefr_level?: string;
  cefr_source?: string;
  cefr_source_version?: string;
  cefr_basis?: string;
  status?: string;
  review_notes?: string;
}

export const CURATION_REVIEW_COLUMNS = [
  'word',
  'learner_rank',
  'sense_order',
  'sense_key',
  'part_of_speech',
  'definition_en',
  'definition_vi',
  'examples_en',
  'examples_vi',
  'definition_source',
  'definition_source_version',
  'definition_source_artifact_sha256',
  'current_cefr_level',
  'cefr_source',
  'cefr_source_version',
  'cefr_basis',
  'pronunciation_candidates',
  'current_status',
  'known_gaps',
  'semantic_decision',
  'translation_decision',
  'example_decision',
  'cefr_decision',
  'approved_cefr_level',
  'pronunciation_decision',
  'reviewer',
  'reviewed_at',
  'reviewer_notes',
] as const;

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

export function renderCurationReviewWorksheet(rows: readonly CurationReviewRow[]): string {
  const renderedRows = rows.map((row) => {
    const examples = row.examples || [];
    const pronunciations = row.pronunciations || [];
    const values = [
      row.word,
      row.learner_rank,
      row.sense_order,
      row.sense_key,
      row.part_of_speech,
      row.definition_en,
      row.definition_vi,
      examples.map((example, index) => `${index + 1}. ${example.en}`).join('\n'),
      examples.map((example, index) => `${index + 1}. ${example.vi}`).join('\n'),
      row.definition_source,
      row.definition_source_version,
      row.definition_source_artifact_sha256,
      row.cefr_level,
      row.cefr_source,
      row.cefr_source_version,
      row.cefr_basis,
      pronunciations.map((pronunciation) => (
        `${pronunciation.accent}: /${pronunciation.ipa.replace(/^\/+|\/+$/gu, '')}/ `
        + `[${pronunciation.review_status || 'draft'}; ${pronunciation.source}; ${pronunciation.source_license}]`
      )).join('\n'),
      row.status || 'draft',
      row.review_notes,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ];
    return values.map(csvCell).join(',');
  });
  return `${CURATION_REVIEW_COLUMNS.join(',')}\n${renderedRows.join('\n')}\n`;
}
