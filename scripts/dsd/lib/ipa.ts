/**
 * IPA normalization, comparison, and the rules that force a human to look.
 *
 * Two ideas run through this file.
 *
 * The first is that stress is content. Normalization folds delimiters,
 * whitespace and Unicode variants, and it deliberately does not touch ˈ or ˌ:
 * `ˈrekɔːrd` and `rɪˈkɔːrd` are different words, and a normalizer that dropped
 * stress would call them the same.
 *
 * The second is that a tool is a suggestion. Nothing here approves anything.
 * It produces agreement and escalation reasons, and every escalation makes a
 * candidate harder to accept, never easier.
 */

export const IPA_ACCENTS = ['en-US'] as const;
export type IpaAccent = (typeof IPA_ACCENTS)[number];

/**
 * Symbols an en-US transcription may contain. An allowlist rather than a
 * blocklist: an unexpected symbol usually means the tool emitted a different
 * notation, and guessing which is worse than refusing.
 */
const IPA_SYMBOLS = new Set(
  [
    // consonants
    'p', 'b', 't', 'd', 'k', 'ɡ', 'f', 'v', 'θ', 'ð', 's', 'z', 'ʃ', 'ʒ', 'h',
    'm', 'n', 'ŋ', 'l', 'r', 'ɹ', 'j', 'w', 'tʃ', 'dʒ', 'ʔ', 'ɾ',
    // vowels
    'i', 'ɪ', 'e', 'ɛ', 'æ', 'ɑ', 'ɒ', 'ɔ', 'o', 'ʊ', 'u', 'ʌ', 'ə', 'ɚ', 'ɝ',
    'ɜ', 'a', 'y',
    // modifiers kept as content
    'ː', 'ˈ', 'ˌ', '.', ' ',
  ].flatMap((s) => [...s]),
);

/**
 * Fold what is notation, keep what is pronunciation.
 *
 * Delimiters go: /ˈrʌn/ and [ˈrʌn] are the same transcription written two
 * ways. The ASCII apostrophe and comma that tools emit for stress become the
 * real marks. `g` becomes `ɡ`, which is the IPA letter rather than the Latin
 * one — they look identical and hash differently.
 */
export function normalizeIpa(value: string): string {
  return (value ?? '')
    .normalize('NFC')
    .trim()
    .replace(/^[/[]|[/\]]$/g, '')
    .replace(/[ˈ'`´]/g, 'ˈ')
    .replace(/[ˌ,]/g, 'ˌ')
    .replace(/g/g, 'ɡ')
    .replace(/:/g, 'ː')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Stress marks removed. Used only to say *how* two candidates differ. */
export function stripStress(value: string): string {
  return normalizeIpa(value).replace(/[ˈˌ]/g, '');
}

export function unknownIpaSymbols(value: string): string[] {
  return [...new Set([...normalizeIpa(value)].filter((char) => !IPA_SYMBOLS.has(char)))];
}

export type Agreement = 'identical' | 'stress_only' | 'segments_differ' | 'unavailable';

/**
 * How two tools' candidates relate.
 *
 * `stress_only` is called out rather than folded into agreement because it is
 * the disagreement most likely to be waved through, and stress is the part of
 * a transcription a learner most needs to be right.
 */
export function compareCandidates(a: string | null, b: string | null): Agreement {
  if (!a || !b) return 'unavailable';
  if (normalizeIpa(a) === normalizeIpa(b)) return 'identical';
  if (stripStress(a) === stripStress(b)) return 'stress_only';
  return 'segments_differ';
}

export interface IpaEscalationInput {
  headword: string;
  /** More than one is a homograph risk: two spellings, two pronunciations. */
  partsOfSpeech: string[];
  candidates: Array<{ toolId: string; ipa: string }>;
  /** False when the comparison adapter could not be built or run. */
  comparisonAvailable: boolean;
}

const ABBREVIATION = /^(?:[A-Z]{2,}|(?:[A-Za-z]\.){2,})$/;
const PROPER_NAME = /^[A-Z][a-z]+(?:[ -][A-Z][a-z]+)*$/;

/**
 * Why a human must look closely at this one.
 *
 * Returns reasons, not a verdict. Every IPA record needs an author and a
 * different reviewer regardless; these are the cases where accepting a
 * candidate as written is most likely to be wrong, and the review command
 * refuses to apply any of them without an explicit acknowledgement.
 */
export function escalationReasons(input: IpaEscalationInput): string[] {
  const reasons: string[] = [];
  const headword = (input.headword ?? '').trim();

  if (input.partsOfSpeech.length > 1) {
    reasons.push(
      `homograph: ${input.partsOfSpeech.join(', ')} may not share a pronunciation`,
    );
  }
  if (ABBREVIATION.test(headword)) {
    reasons.push('abbreviation: letter-by-letter and word pronunciations both occur');
  } else if (PROPER_NAME.test(headword)) {
    // Grapheme-to-phoneme models are trained on ordinary vocabulary and are at
    // their least reliable on names.
    reasons.push('proper name: grapheme-to-phoneme output is unreliable here');
  }

  const [first, second] = input.candidates;
  if (!input.comparisonAvailable || input.candidates.length < 2) {
    reasons.push('single tool: no independent candidate to disagree with');
  } else {
    const agreement = compareCandidates(first?.ipa ?? null, second?.ipa ?? null);
    if (agreement === 'stress_only') {
      reasons.push(`stress disagreement between ${first.toolId} and ${second.toolId}`);
    } else if (agreement === 'segments_differ') {
      reasons.push(`segment disagreement between ${first.toolId} and ${second.toolId}`);
    }
  }

  for (const candidate of input.candidates) {
    const unknown = unknownIpaSymbols(candidate.ipa);
    if (unknown.length > 0) {
      reasons.push(`${candidate.toolId} emitted unexpected symbols: ${unknown.join(' ')}`);
    }
  }

  return reasons;
}

/**
 * Validate a human-authored transcription.
 *
 * Separate from the escalation rules: those describe how much scrutiny a
 * record needs, this describes whether what came back is a transcription at
 * all.
 */
export function validateIpa(value: string, accent: string): string[] {
  const errors: string[] = [];
  const ipa = normalizeIpa(value);

  if (!(IPA_ACCENTS as readonly string[]).includes(accent)) {
    errors.push(`accent '${accent}' is not supported`);
  }
  if (!ipa) {
    errors.push('transcription is empty');
    return errors;
  }
  const unknown = unknownIpaSymbols(ipa);
  if (unknown.length > 0) {
    errors.push(`unexpected symbols: ${unknown.join(' ')}`);
  }
  if (!/[ˈ]/.test(ipa) && ipa.replace(/[^aeiouɪɛæɑɒɔʊʌəɚɝɜy]/g, '').length > 1) {
    // A word with more than one vowel has a stressed syllable. A transcription
    // that does not mark it is incomplete rather than wrong.
    errors.push('multi-syllable transcription has no primary stress mark');
  }
  if (/[/[\]]/.test(ipa)) {
    errors.push('delimiters should be stripped, not stored');
  }
  return errors;
}
