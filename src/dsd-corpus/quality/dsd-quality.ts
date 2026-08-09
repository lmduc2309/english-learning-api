/**
 * Deterministic linguistic validation for DSD content.
 *
 * Every rule here is a pure function of the text. That is deliberate: because
 * quality is computable from the row, the publication gate can run these checks
 * live instead of trusting a verdict stored earlier, and there is no way for an
 * approved record to drift past a check that passed against older text.
 *
 * Findings are critical or warning, and the distinction is load-bearing. A
 * critical finding blocks publication. A warning is reported and counted, and
 * is never converted into an approval by anything in this file — deciding a
 * warning is acceptable is a person's job, recorded as a review decision.
 *
 * Nothing here reads a database or imports a connector. The rules operate on
 * values handed to them, so they cannot reach a legacy row even by accident.
 */

export type QualitySeverity = 'critical' | 'warning';

export interface QualityFinding {
  rule: string;
  severity: QualitySeverity;
  entityKind: 'sense' | 'translation' | 'example' | 'corpus';
  entityId: string;
  message: string;
}

export const PART_OF_SPEECH_ALLOWLIST = [
  'noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition',
  'conjunction', 'interjection', 'determiner', 'numeral', 'phrase',
];

/** DSD-owned register and grammar labels. Not imported from any dictionary. */
export const USAGE_LABEL_ALLOWLIST = [
  'general', 'formal', 'informal', 'literary', 'technical', 'medical', 'legal',
  'archaic', 'slang', 'offensive', 'figurative', 'regional', 'british',
  'american', 'countable', 'uncountable', 'transitive', 'intransitive',
];

// ─── character-class tripwires ──────────────────────────────────────────────

/** Hiragana, katakana, Han, and Hangul. */
const CJK = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;
/** Cyrillic, Greek, Hebrew, Arabic, Syriac, Devanagari, Thai. */
const OTHER_SCRIPTS =
  /[\u0370-\u03FF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0900-\u097F\u0E00-\u0E7F]/;
/**
 * Characters that occur in Vietnamese and effectively nowhere in English.
 * Deliberately excludes Latin-1 accents, so café and naïve are not flagged.
 */
const VIETNAMESE_MARKERS = /[\u0102\u0103\u0110\u0111\u01A0\u01A1\u01AF\u01B0\u1EA0-\u1EF9]/;

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const INVISIBLE_CHARS = /[\u200B-\u200D\u2060\uFEFF]/;
const REPLACEMENT_CHAR = /\uFFFD/;

const HTML_TAG = /<\/?[a-z][a-z0-9]*(?:\s[^>]*)?>/i;
const HTML_ENTITY = /&(?:nbsp|amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/i;
const WIKI_MARKUP = /\{\{|\}\}|\[\[|\]\]/;
const MARKDOWN_LINK = /\]\(/;
const CODE_FENCE = /```/;

/**
 * Text an assistant emits around an answer rather than as one. If any of this
 * reaches a definition, a generation step ran that DSD v1 does not permit.
 */
const PROMPT_LEAKAGE =
  /\b(?:as an ai\b|language model\b|i (?:cannot|can't|am unable to)\b|here (?:is|are) (?:the|a|an|your)\b|sure[,!]\s|certainly[,!]\s|assistant:|system:|user:|translate the following\b|output only\b|json\b.*\bformat\b)/i;

/** Neutralises a leading character a spreadsheet would treat as a formula. */
export function isFormulaInjection(value: string): boolean {
  return /^[=+\-@\t\r]/.test(value ?? '');
}

/** Quote every value, double internal quotes, and neutralise formula prefixes. */
export function toCsvCell(value: string | null | undefined): string {
  const raw = value ?? '';
  const guarded = isFormulaInjection(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function normalize(value: string): string {
  return (value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

function comparable(value: string): string {
  return normalize(value).toLowerCase().replace(/[.,;:!?"'()‘’“”]/g, '');
}

function words(value: string): string[] {
  return comparable(value).split(' ').filter(Boolean);
}

/**
 * Function words and definitional filler. Excluded when measuring how much a
 * definition actually explains, because "the act of rehearsing" is circular
 * however many words it takes to say it.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from',
  'that', 'which', 'who', 'or', 'and', 'is', 'are', 'was', 'were', 'be',
  'being', 'been', 'as', 'into', 'it', 'its', 'their', 'this', 'these',
  'those', 'something', 'someone', 'somebody', 'somewhere', 'act', 'state',
  'quality', 'manner',
]);

/**
 * Regular English inflections. Irregular forms are declared per record as
 * approvedInflections — guessing them would either miss real problems or
 * invent forms that are not words.
 */
export function inflectionsOf(headword: string, partOfSpeech: string): string[] {
  const base = normalize(headword).toLowerCase();
  if (!base) return [];

  const forms = new Set<string>([base]);
  const sibilant = /(?:s|x|z|ch|sh)$/.test(base);
  const consonantY = /[^aeiou]y$/.test(base);
  const silentE = /e$/.test(base);
  const stem = silentE ? base.slice(0, -1) : base;
  const yStem = consonantY ? base.slice(0, -1) : base;

  const addPlural = () => {
    if (consonantY) forms.add(`${yStem}ies`);
    else forms.add(`${base}${sibilant ? 'es' : 's'}`);
  };

  switch (partOfSpeech) {
    case 'verb':
      addPlural();
      forms.add(consonantY ? `${yStem}ied` : silentE ? `${base}d` : `${base}ed`);
      forms.add(`${stem}ing`);
      break;
    case 'noun':
      addPlural();
      break;
    case 'adjective':
    case 'adverb':
      forms.add(consonantY ? `${yStem}ier` : `${stem}er`);
      forms.add(consonantY ? `${yStem}iest` : `${stem}est`);
      break;
    default:
      break;
  }

  return [...forms];
}

function containsForm(text: string, forms: string[]): boolean {
  const haystack = ` ${comparable(text)} `;
  return forms.some((form) => haystack.includes(` ${form} `));
}

// ─── shared text rules ──────────────────────────────────────────────────────

interface Context {
  entityKind: QualityFinding['entityKind'];
  entityId: string;
  field: string;
}

function checkText(value: string, context: Context): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const add = (rule: string, severity: QualitySeverity, message: string) =>
    findings.push({ rule, severity, entityKind: context.entityKind, entityId: context.entityId, message });

  const text = value ?? '';

  if (!normalize(text)) {
    add('empty_content', 'critical', `${context.field} is empty or whitespace only`);
    return findings;
  }

  if (CONTROL_CHARS.test(text)) {
    add('control_characters', 'critical', `${context.field} contains control characters`);
  }
  if (INVISIBLE_CHARS.test(text)) {
    // Two rows that look identical but hash differently defeat every dedupe
    // and every hash-bound approval in the system.
    add('invisible_characters', 'critical', `${context.field} contains zero-width characters`);
  }
  if (REPLACEMENT_CHAR.test(text)) {
    add('encoding_damage', 'critical', `${context.field} contains U+FFFD — the text was decoded wrongly`);
  }
  if (HTML_TAG.test(text) || HTML_ENTITY.test(text)) {
    add('raw_markup', 'critical', `${context.field} contains HTML`);
  }
  if (WIKI_MARKUP.test(text)) {
    add('raw_markup', 'critical', `${context.field} contains wiki template or link markup`);
  }
  if (MARKDOWN_LINK.test(text) || CODE_FENCE.test(text)) {
    add('raw_markup', 'critical', `${context.field} contains markdown markup`);
  }
  if (PROMPT_LEAKAGE.test(text)) {
    add('prompt_leakage', 'critical', `${context.field} contains generation wrapper or prompt text`);
  }
  if (isFormulaInjection(normalize(text))) {
    add('formula_injection', 'critical', `${context.field} starts with a spreadsheet formula character`);
  }

  return findings;
}

function checkEnglishScript(value: string, context: Context): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const add = (rule: string, message: string) =>
    findings.push({ rule, severity: 'critical' as const, entityKind: context.entityKind, entityId: context.entityId, message });

  if (CJK.test(value)) add('non_english_script', `${context.field} contains CJK characters`);
  if (OTHER_SCRIPTS.test(value)) add('non_english_script', `${context.field} contains a non-Latin script`);
  if (VIETNAMESE_MARKERS.test(value)) {
    add('vietnamese_in_english', `${context.field} contains Vietnamese characters`);
  }
  return findings;
}

function checkVietnameseScript(value: string, context: Context): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const add = (rule: string, message: string) =>
    findings.push({ rule, severity: 'critical' as const, entityKind: context.entityKind, entityId: context.entityId, message });

  if (CJK.test(value)) add('cjk_in_vietnamese', `${context.field} contains CJK characters`);
  if (OTHER_SCRIPTS.test(value)) add('unexpected_script', `${context.field} contains a non-Latin script`);
  return findings;
}

// ─── record rules ───────────────────────────────────────────────────────────

export interface DefinitionRecord {
  entityId: string;
  headword: string;
  partOfSpeech: string;
  definitionEn: string;
  usageLabels: string[];
  approvedInflections?: string[];
}

export interface TranslationRecord {
  entityId: string;
  headword: string;
  definitionEn: string;
  locale: string;
  text: string;
}

export interface ExampleRecord {
  entityId: string;
  headword: string;
  partOfSpeech: string;
  exampleEn: string;
  exampleVi: string;
  approvedInflections?: string[];
}

const MIN_DEFINITION_CHARS = 10;
const MAX_DEFINITION_CHARS = 400;
const LONG_DEFINITION_CHARS = 250;
const MIN_EXAMPLE_WORDS = 3;
const MAX_EXAMPLE_CHARS = 300;
const LONG_EXAMPLE_CHARS = 200;
const MAX_TRANSLATION_CHARS = 200;
/** A definition that is only the headword plus this many words explains nothing. */
const MIN_EXPLANATORY_WORDS = 3;

export function checkDefinition(record: DefinitionRecord): QualityFinding[] {
  const context: Context = { entityKind: 'sense', entityId: record.entityId, field: 'definition_en' };
  const findings = checkText(record.definitionEn, context);
  const add = (rule: string, severity: QualitySeverity, message: string) =>
    findings.push({ rule, severity, entityKind: 'sense', entityId: record.entityId, message });

  if (!PART_OF_SPEECH_ALLOWLIST.includes(record.partOfSpeech)) {
    add('pos_allowlist', 'critical', `part of speech '${record.partOfSpeech}' is not allowed`);
  }
  for (const label of record.usageLabels ?? []) {
    if (!USAGE_LABEL_ALLOWLIST.includes(label)) {
      add('usage_label_allowlist', 'critical', `usage label '${label}' is not allowed`);
    }
  }

  const definition = normalize(record.definitionEn);
  if (!definition) return findings;

  findings.push(...checkEnglishScript(definition, context));

  if (definition.length < MIN_DEFINITION_CHARS) {
    add('definition_too_short', 'critical', `definition is ${definition.length} characters`);
  }
  if (definition.length > MAX_DEFINITION_CHARS) {
    add('definition_too_long', 'critical', `definition is ${definition.length} characters`);
  } else if (definition.length > LONG_DEFINITION_CHARS) {
    add('definition_long', 'warning', `definition is ${definition.length} characters — consider splitting the sense`);
  }
  if (/[,;:]$/.test(definition)) {
    add('definition_truncated', 'warning', 'definition ends mid-clause');
  }

  const forms = [
    ...inflectionsOf(record.headword, record.partOfSpeech),
    ...(record.approvedInflections ?? []).map((f) => f.toLowerCase()),
  ];

  if (comparable(definition) === comparable(record.headword)) {
    add('headword_only_definition', 'critical', 'the definition is just the headword');
  } else if (containsForm(definition, forms)) {
    const remaining = words(definition).filter(
      (word) => !forms.includes(word) && !STOPWORDS.has(word),
    );
    if (remaining.length < MIN_EXPLANATORY_WORDS) {
      add('circular_definition', 'critical', 'the definition explains the headword with itself');
    } else {
      add('defines_with_headword', 'warning', 'the definition uses the headword');
    }
  }

  return findings;
}

export function checkTranslation(record: TranslationRecord): QualityFinding[] {
  const context: Context = { entityKind: 'translation', entityId: record.entityId, field: 'text' };
  const findings = checkText(record.text, context);
  const add = (rule: string, severity: QualitySeverity, message: string) =>
    findings.push({ rule, severity, entityKind: 'translation', entityId: record.entityId, message });

  if (record.locale !== 'vi') {
    add('locale_allowlist', 'critical', `locale '${record.locale}' is not supported`);
  }

  const text = normalize(record.text);
  if (!text) return findings;

  findings.push(...checkVietnameseScript(text, context));

  if (comparable(text) === comparable(record.definitionEn)) {
    add('untranslated', 'critical', 'the Vietnamese is identical to the English definition');
  }
  if (comparable(text) === comparable(record.headword)) {
    // The legacy corpus is full of these: a headword copied into the
    // translation column and never translated.
    add('headword_echo', 'critical', 'the Vietnamese is just the English headword');
  }
  if (text.length > MAX_TRANSLATION_CHARS) {
    add('translation_long', 'warning', `translation is ${text.length} characters — this reads like a definition`);
  }

  return findings;
}

export function checkExample(record: ExampleRecord): QualityFinding[] {
  const enContext: Context = { entityKind: 'example', entityId: record.entityId, field: 'example_en' };
  const viContext: Context = { entityKind: 'example', entityId: record.entityId, field: 'example_vi' };
  const findings = [...checkText(record.exampleEn, enContext), ...checkText(record.exampleVi, viContext)];
  const add = (rule: string, severity: QualitySeverity, message: string) =>
    findings.push({ rule, severity, entityKind: 'example', entityId: record.entityId, message });

  const en = normalize(record.exampleEn);
  const vi = normalize(record.exampleVi);

  if (en) {
    findings.push(...checkEnglishScript(en, enContext));

    if (words(en).length < MIN_EXAMPLE_WORDS) {
      add('example_too_short', 'critical', 'the English example is not a sentence');
    }
    if (en.length > MAX_EXAMPLE_CHARS) {
      add('example_too_long', 'critical', `the English example is ${en.length} characters`);
    } else if (en.length > LONG_EXAMPLE_CHARS) {
      add('example_long', 'warning', `the English example is ${en.length} characters`);
    }
    if (!/[.!?]$/.test(en)) {
      add('sentence_form', 'warning', 'the English example does not end as a sentence');
    }
    if (!/^[A-Z"'“]/.test(en)) {
      add('sentence_form', 'warning', 'the English example does not start with a capital');
    }

    const forms = [
      ...inflectionsOf(record.headword, record.partOfSpeech),
      ...(record.approvedInflections ?? []).map((f) => f.toLowerCase()),
    ];
    if (!containsForm(en, forms)) {
      // An example that never uses the word teaches nothing about it. An
      // irregular form is declared, not guessed.
      add(
        'lemma_missing',
        'critical',
        `the example does not use '${record.headword}' or an approved inflection`,
      );
    }
  }

  if (vi) {
    findings.push(...checkVietnameseScript(vi, viContext));
    if (en && comparable(vi) === comparable(en)) {
      add('untranslated', 'critical', 'the Vietnamese example is identical to the English');
    }
  }

  return findings;
}

// ─── corpus rules ───────────────────────────────────────────────────────────

/** Definitions sharing this many opening words look like a filled-in template. */
const BOILERPLATE_PREFIX_WORDS = 5;
const BOILERPLATE_THRESHOLD = 5;

export function checkCorpus(input: {
  definitions: DefinitionRecord[];
  examples: ExampleRecord[];
}): QualityFinding[] {
  const findings: QualityFinding[] = [];

  const seenDefinitions = new Map<string, string>();
  for (const record of input.definitions) {
    const key = `${record.partOfSpeech} ${comparable(record.definitionEn)}`;
    const first = seenDefinitions.get(key);
    if (first) {
      findings.push({
        rule: 'duplicate_definition',
        severity: 'critical',
        entityKind: 'sense',
        entityId: record.entityId,
        message: `same definition and part of speech as ${first}`,
      });
    } else {
      seenDefinitions.set(key, record.entityId);
    }
  }

  const seenExamples = new Map<string, string>();
  for (const record of input.examples) {
    const key = comparable(record.exampleEn);
    if (!key) continue;
    const first = seenExamples.get(key);
    if (first) {
      findings.push({
        rule: 'duplicate_example',
        severity: 'critical',
        entityKind: 'example',
        entityId: record.entityId,
        message: `same English example as ${first}`,
      });
    } else {
      seenExamples.set(key, record.entityId);
    }
  }

  const prefixes = new Map<string, string[]>();
  for (const record of input.definitions) {
    const prefix = words(record.definitionEn).slice(0, BOILERPLATE_PREFIX_WORDS).join(' ');
    if (words(record.definitionEn).length <= BOILERPLATE_PREFIX_WORDS) continue;
    prefixes.set(prefix, [...(prefixes.get(prefix) ?? []), record.entityId]);
  }
  for (const [prefix, ids] of prefixes) {
    if (ids.length >= BOILERPLATE_THRESHOLD) {
      findings.push({
        rule: 'repeated_boilerplate',
        severity: 'warning',
        entityKind: 'corpus',
        entityId: ids[0],
        message: `${ids.length} definitions begin "${prefix}"`,
      });
    }
  }

  return findings;
}

export function criticalFindings(findings: QualityFinding[]): QualityFinding[] {
  return findings.filter((finding) => finding.severity === 'critical');
}

export function summarize(findings: QualityFinding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const finding of findings) {
    counts[`${finding.severity}:${finding.rule}`] = (counts[`${finding.severity}:${finding.rule}`] ?? 0) + 1;
  }
  return counts;
}
