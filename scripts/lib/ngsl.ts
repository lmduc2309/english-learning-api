export const NGSL_VERSION = '1.2';
export const NGSL_EXPECTED_ROW_COUNT = 2809;
export const NGSL_SUPPLEMENT_EXPECTED_ROW_COUNT = 52;
export const NGSL_EXPECTED_CANDIDATE_COUNT = 2859;

export const NGSL_ACKNOWLEDGED_CASE_FOLD_COLLISIONS = [
  { coreLemma: 'march', supplementLemma: 'March', candidateWord: 'march' },
  { coreLemma: 'may', supplementLemma: 'May', candidateWord: 'may' },
] as const;

export const NGSL_STATS_HEADER = [
  'Lemma',
  'SFI Rank',
  'SFI',
  'Adjusted Frequency per Million (U)',
] as const;

export const NGSL_CANDIDATE_HEADER = [
  'priority_order',
  'normalized_word',
  'learner_rank',
  'source_memberships',
  'original_source_lemmas',
  'rank_source',
  'rank_source_version',
  'rank_source_url',
  'rank_source_license',
] as const;

export const NGSL_RANK_PROVENANCE = {
  source: 'New General Service List',
  version: NGSL_VERSION,
  url: 'https://www.newgeneralservicelist.com/new-general-service-list',
  license: 'CC BY-SA 4.0',
} as const;

export interface NgslCoreRow {
  lemma: string;
  normalizedLemma: string;
  rank: number;
  sfi: number;
  adjustedFrequencyPerMillion: number;
}

export interface NgslSupplementRow {
  lemma: string;
  normalizedLemma: string;
  forms: string[];
  rank: null;
}

export interface NgslCandidate {
  word: string;
  rank: number | null;
  sourceMemberships: Array<'ngsl-core' | 'ngsl-supplement'>;
  sourceLemmas: string[];
}

export interface NgslCaseFoldCollision {
  candidateWord: string;
  coreLemma: string;
  coreRank: number;
  supplementLemma: string;
  supplementRank: null;
}

function stripUtf8Bom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

export function normalizeLemma(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase('en-US');
}

export function normalizeNgslRank(rank: 0): null;
export function normalizeNgslRank(rank: number | null): number | null;
export function normalizeNgslRank(rank: number | null): number | null {
  return rank === 0 ? null : rank;
}

/**
 * Parse the small CSV dialect used by the two official NGSL files. Supporting
 * quoted fields keeps validation safe if a future source adds commas to a
 * field, while all source-specific shape checks remain strict below.
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (quoted) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === ',') {
      fields.push(field);
      field = '';
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error('Malformed CSV: unterminated quoted field');
  fields.push(field);
  return fields;
}

function nonEmptyLines(bytes: Buffer): string[] {
  const text = stripUtf8Bom(bytes.toString('utf8'));
  return text
    .split(/\r?\n/u)
    .map((line) => line.replace(/\r$/u, ''))
    .filter((line) => line.trim().length > 0);
}

function assertFiniteNumber(value: string, field: string, rowNumber: number): number {
  if (value.trim().length === 0) {
    throw new Error(`NGSL row ${rowNumber}: ${field} must not be empty`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`NGSL row ${rowNumber}: ${field} must be a finite number`);
  }
  return parsed;
}

export function parseAndValidateNgslStats(bytes: Buffer): NgslCoreRow[] {
  const lines = nonEmptyLines(bytes);
  if (lines.length === 0) throw new Error('NGSL statistics file is empty');

  const actualHeader = parseCsvLine(lines[0]);
  if (
    actualHeader.length !== NGSL_STATS_HEADER.length ||
    actualHeader.some((field, index) => field !== NGSL_STATS_HEADER[index])
  ) {
    throw new Error(
      `Unexpected NGSL header. Expected exactly: ${NGSL_STATS_HEADER.join(',')}`,
    );
  }

  const dataLines = lines.slice(1);
  if (dataLines.length !== NGSL_EXPECTED_ROW_COUNT) {
    throw new Error(
      `Expected ${NGSL_EXPECTED_ROW_COUNT} NGSL rows, received ${dataLines.length}`,
    );
  }

  const seenLemmas = new Set<string>();
  const seenNormalizedLemmas = new Set<string>();
  const seenRanks = new Set<number>();
  const rows = dataLines.map((line, index): NgslCoreRow => {
    const rowNumber = index + 2;
    const fields = parseCsvLine(line);
    if (fields.length !== NGSL_STATS_HEADER.length) {
      throw new Error(
        `NGSL row ${rowNumber}: expected ${NGSL_STATS_HEADER.length} fields, received ${fields.length}`,
      );
    }

    const lemma = fields[0].normalize('NFC').trim();
    const normalizedLemma = normalizeLemma(lemma);
    if (!normalizedLemma) throw new Error(`NGSL row ${rowNumber}: lemma must not be empty`);
    if (seenLemmas.has(lemma) || seenNormalizedLemmas.has(normalizedLemma)) {
      throw new Error(`NGSL row ${rowNumber}: duplicate lemma ${JSON.stringify(lemma)}`);
    }
    seenLemmas.add(lemma);
    seenNormalizedLemmas.add(normalizedLemma);

    const rank = assertFiniteNumber(fields[1], 'SFI Rank', rowNumber);
    if (!Number.isInteger(rank) || rank < 1) {
      throw new Error(`NGSL row ${rowNumber}: SFI Rank must be a positive integer`);
    }
    if (seenRanks.has(rank)) {
      throw new Error(`NGSL row ${rowNumber}: duplicate SFI Rank ${rank}`);
    }
    seenRanks.add(rank);

    return {
      lemma,
      normalizedLemma,
      rank,
      sfi: assertFiniteNumber(fields[2], 'SFI', rowNumber),
      adjustedFrequencyPerMillion: assertFiniteNumber(
        fields[3],
        'Adjusted Frequency per Million (U)',
        rowNumber,
      ),
    };
  });

  for (let rank = 1; rank <= NGSL_EXPECTED_ROW_COUNT; rank += 1) {
    if (!seenRanks.has(rank)) {
      throw new Error(
        `NGSL SFI ranks must be contiguous from 1 to ${NGSL_EXPECTED_ROW_COUNT}; missing ${rank}`,
      );
    }
  }

  return rows.sort((left, right) => left.rank - right.rank);
}

export function parseAndValidateNgslSupplement(
  bytes: Buffer,
  coreRows: readonly NgslCoreRow[],
): NgslSupplementRow[] {
  const lines = nonEmptyLines(bytes);
  if (lines.length !== NGSL_SUPPLEMENT_EXPECTED_ROW_COUNT) {
    throw new Error(
      `Expected ${NGSL_SUPPLEMENT_EXPECTED_ROW_COUNT} NGSL supplement rows, received ${lines.length}`,
    );
  }

  const coreLemmas = new Set(coreRows.map((row) => row.lemma));
  const seenLemmas = new Set<string>();

  const rows = lines.map((line, index): NgslSupplementRow => {
    const rowNumber = index + 1;
    const fields = parseCsvLine(line).map((field) => field.normalize('NFC').trim());
    if (fields.length < 2 || fields.some((field) => field.length === 0)) {
      throw new Error(
        `NGSL supplement row ${rowNumber}: expected a lemma and one or more non-empty forms`,
      );
    }

    const lemma = fields[0];
    const normalizedLemma = normalizeLemma(lemma);
    if (!normalizedLemma) {
      throw new Error(`NGSL supplement row ${rowNumber}: lemma must not be empty`);
    }
    if (seenLemmas.has(lemma)) {
      throw new Error(
        `NGSL supplement row ${rowNumber}: duplicate lemma ${JSON.stringify(lemma)}`,
      );
    }
    if (coreLemmas.has(lemma)) {
      throw new Error(
        `NGSL supplement row ${rowNumber}: lemma ${JSON.stringify(lemma)} also occurs in the ranked core`,
      );
    }
    seenLemmas.add(lemma);

    return {
      lemma,
      normalizedLemma,
      forms: fields.slice(1),
      rank: normalizeNgslRank(0),
    };
  });

  const coreByNormalizedLemma = new Map(
    coreRows.map((row) => [row.normalizedLemma, row]),
  );
  const acknowledgedPairs = new Set(
    NGSL_ACKNOWLEDGED_CASE_FOLD_COLLISIONS.map(
      (collision) => `${collision.coreLemma}\u0000${collision.supplementLemma}`,
    ),
  );
  for (const row of rows) {
    const core = coreByNormalizedLemma.get(row.normalizedLemma);
    if (!core) continue;
    const pair = `${core.lemma}\u0000${row.lemma}`;
    if (!acknowledgedPairs.has(pair)) {
      throw new Error(
        `NGSL supplement case-fold collision is not acknowledged: `
        + `${JSON.stringify(row.lemma)} and ranked core ${JSON.stringify(core.lemma)}`,
      );
    }
  }

  return rows;
}

export function findNgslCaseFoldCollisions(
  coreRows: readonly NgslCoreRow[],
  supplementRows: readonly NgslSupplementRow[],
): NgslCaseFoldCollision[] {
  const coreByNormalizedLemma = new Map(
    coreRows.map((row) => [row.normalizedLemma, row]),
  );
  return supplementRows.flatMap((supplement) => {
    const core = coreByNormalizedLemma.get(supplement.normalizedLemma);
    if (!core) return [];
    return [{
      candidateWord: supplement.normalizedLemma,
      coreLemma: core.lemma,
      coreRank: core.rank,
      supplementLemma: supplement.lemma,
      supplementRank: supplement.rank,
    }];
  });
}

export function assertExpectedNgslCaseFoldCollisions(
  collisions: readonly NgslCaseFoldCollision[],
): void {
  const actual = collisions.map(
    ({ candidateWord, coreLemma, supplementLemma }) =>
      `${candidateWord}\u0000${coreLemma}\u0000${supplementLemma}`,
  ).sort();
  const expected = NGSL_ACKNOWLEDGED_CASE_FOLD_COLLISIONS
    .map(({ candidateWord, coreLemma, supplementLemma }) =>
      `${candidateWord}\u0000${coreLemma}\u0000${supplementLemma}`,
    ).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `NGSL case-fold collision set changed. Expected ${JSON.stringify(expected)}, `
      + `received ${JSON.stringify(actual)}`,
    );
  }
}

export function buildNgslCandidates(
  coreRows: readonly NgslCoreRow[],
  supplementRows: readonly NgslSupplementRow[],
): NgslCandidate[] {
  const candidates = [...coreRows]
    .sort((left, right) => left.rank - right.rank)
    .map((row): NgslCandidate => ({
      word: row.normalizedLemma,
      rank: row.rank,
      sourceMemberships: ['ngsl-core'],
      sourceLemmas: [row.lemma],
    }));
  const byWord = new Map(candidates.map((candidate) => [candidate.word, candidate]));
  for (const row of supplementRows) {
    const existing = byWord.get(row.normalizedLemma);
    if (existing) {
      existing.sourceMemberships.push('ngsl-supplement');
      existing.sourceLemmas.push(row.lemma);
      continue;
    }
    const candidate: NgslCandidate = {
      word: row.normalizedLemma,
      rank: row.rank,
      sourceMemberships: ['ngsl-supplement'],
      sourceLemmas: [row.lemma],
    };
    candidates.push(candidate);
    byWord.set(candidate.word, candidate);
  }
  return candidates;
}

export function renderCandidateWords(candidates: readonly NgslCandidate[]): Buffer {
  return Buffer.from(`${candidates.map((candidate) => candidate.word).join('\n')}\n`, 'utf8');
}

function renderCsvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

export function renderNgslCandidateCsv(candidates: readonly NgslCandidate[]): Buffer {
  const rows = candidates.map((candidate, index) => [
    index + 1,
    candidate.word,
    candidate.rank ?? '',
    JSON.stringify(candidate.sourceMemberships),
    JSON.stringify(candidate.sourceLemmas),
    NGSL_RANK_PROVENANCE.source,
    NGSL_RANK_PROVENANCE.version,
    NGSL_RANK_PROVENANCE.url,
    NGSL_RANK_PROVENANCE.license,
  ].map(renderCsvCell).join(','));
  return Buffer.from(`${NGSL_CANDIDATE_HEADER.join(',')}\n${rows.join('\n')}\n`, 'utf8');
}

function parseStringArray(value: string, field: string, rowNumber: number): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`NGSL candidate row ${rowNumber}: ${field} must be a JSON string array`);
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    throw new Error(`NGSL candidate row ${rowNumber}: ${field} must be a non-empty JSON string array`);
  }
  return parsed;
}

export function parseAndValidateNgslCandidateCsv(
  bytes: Buffer,
  expectedCandidates?: readonly NgslCandidate[],
): NgslCandidate[] {
  const lines = nonEmptyLines(bytes);
  if (lines.length === 0) throw new Error('NGSL candidate table is empty');
  const header = parseCsvLine(lines[0]);
  if (
    header.length !== NGSL_CANDIDATE_HEADER.length ||
    header.some((field, index) => field !== NGSL_CANDIDATE_HEADER[index])
  ) {
    throw new Error(
      `Unexpected NGSL candidate header. Expected exactly: ${NGSL_CANDIDATE_HEADER.join(',')}`,
    );
  }

  const dataLines = lines.slice(1);
  if (dataLines.length !== NGSL_EXPECTED_CANDIDATE_COUNT) {
    throw new Error(
      `Expected ${NGSL_EXPECTED_CANDIDATE_COUNT} NGSL candidate rows, received ${dataLines.length}`,
    );
  }
  if (expectedCandidates && expectedCandidates.length !== dataLines.length) {
    throw new Error(
      `Expected candidate model has ${expectedCandidates.length} rows, table has ${dataLines.length}`,
    );
  }

  const seenWords = new Set<string>();
  return dataLines.map((line, index): NgslCandidate => {
    const rowNumber = index + 2;
    const fields = parseCsvLine(line);
    if (fields.length !== NGSL_CANDIDATE_HEADER.length) {
      throw new Error(
        `NGSL candidate row ${rowNumber}: expected ${NGSL_CANDIDATE_HEADER.length} fields, received ${fields.length}`,
      );
    }

    const priority = Number(fields[0]);
    if (!Number.isInteger(priority) || priority !== index + 1) {
      throw new Error(
        `NGSL candidate row ${rowNumber}: priority_order must be contiguous and equal ${index + 1}`,
      );
    }
    const word = fields[1];
    if (!word || normalizeLemma(word) !== word) {
      throw new Error(`NGSL candidate row ${rowNumber}: normalized_word is not normalized`);
    }
    if (seenWords.has(word)) {
      throw new Error(`NGSL candidate row ${rowNumber}: duplicate normalized_word ${JSON.stringify(word)}`);
    }
    seenWords.add(word);

    const rank = fields[2] === '' ? null : Number(fields[2]);
    if (rank !== null && (!Number.isInteger(rank) || rank < 1)) {
      throw new Error(`NGSL candidate row ${rowNumber}: learner_rank must be blank or a positive integer`);
    }
    const memberships = parseStringArray(fields[3], 'source_memberships', rowNumber);
    if (
      memberships.some((membership) => !['ngsl-core', 'ngsl-supplement'].includes(membership)) ||
      new Set(memberships).size !== memberships.length
    ) {
      throw new Error(`NGSL candidate row ${rowNumber}: invalid or duplicate source_memberships`);
    }
    const sourceMemberships = memberships as NgslCandidate['sourceMemberships'];
    const sourceLemmas = parseStringArray(fields[4], 'original_source_lemmas', rowNumber);
    if (
      sourceLemmas.length !== sourceMemberships.length ||
      sourceLemmas.some((lemma) => normalizeLemma(lemma) !== word)
    ) {
      throw new Error(
        `NGSL candidate row ${rowNumber}: original_source_lemmas must align with memberships and normalized_word`,
      );
    }
    const hasRankedCore = sourceMemberships.includes('ngsl-core');
    if ((hasRankedCore && rank === null) || (!hasRankedCore && rank !== null)) {
      throw new Error(
        `NGSL candidate row ${rowNumber}: learner_rank must be present only for ranked-core membership`,
      );
    }

    const provenance = [
      NGSL_RANK_PROVENANCE.source,
      NGSL_RANK_PROVENANCE.version,
      NGSL_RANK_PROVENANCE.url,
      NGSL_RANK_PROVENANCE.license,
    ];
    if (fields.slice(5).some((field, provenanceIndex) => field !== provenance[provenanceIndex])) {
      throw new Error(`NGSL candidate row ${rowNumber}: rank provenance fields do not match NGSL 1.2`);
    }

    const candidate: NgslCandidate = {
      word,
      rank,
      sourceMemberships,
      sourceLemmas,
    };
    const expected = expectedCandidates?.[index];
    if (
      expected && (
        candidate.word !== expected.word ||
        candidate.rank !== expected.rank ||
        JSON.stringify(candidate.sourceMemberships) !== JSON.stringify(expected.sourceMemberships) ||
        JSON.stringify(candidate.sourceLemmas) !== JSON.stringify(expected.sourceLemmas)
      )
    ) {
      throw new Error(`NGSL candidate row ${rowNumber}: table content does not match validated sources`);
    }
    return candidate;
  });
}
