import { SaxesParser, SaxesTagPlain } from 'saxes';

import {
  NGSL_RANK_PROVENANCE,
  NGSL_VERSION,
  NgslCandidate,
} from './ngsl';

export const OEWN_VERSION = '2025';
export const OEWN_RELEASE_TAG = '2025-edition';
export const OEWN_RELEASE_COMMIT = 'dc343f2683279ecbb13fab4e2fd778d7b162d287';
export const OEWN_SOURCE_ID = 'oewn-2025';
export const OEWN_SOURCE_NAME = 'Open English WordNet';
export const OEWN_SOURCE_URL =
  'https://github.com/globalwordnet/english-wordnet/releases/tag/2025-edition';
export const OEWN_ARTIFACT_URL =
  'https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/english-wordnet-2025.xml.gz';
export const OEWN_LICENSE = 'CC BY 4.0';
export const OEWN_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';
export const OEWN_DTD_URL =
  'http://globalwordnet.github.io/schemas/WN-LMF-1.3.dtd';
export const OEWN_DOCTYPE = `LexicalResource SYSTEM "${OEWN_DTD_URL}"`;
export const OEWN_COMPRESSED_BYTES = 11_363_503;
export const OEWN_UNCOMPRESSED_BYTES = 89_237_271;
export const OEWN_SHA256 =
  '9ca6d1dcb75f822fdd66617f7d9da48142ace38dd544d6ad5e2feca1674ad3fe';

export const OEWN_EXPECTED_COUNTS = {
  lexical_entries: 135_969,
  lemmas: 135_969,
  senses: 185_129,
  synsets: 107_519,
  definitions: 107_524,
  examples: 49_596,
  pronunciations: 43_534,
  forms: 4_473,
  ili_definitions: 3_184,
  sense_relations: 120_254,
  synset_relations: 234_810,
  relations: 355_064,
} as const;

export const OEWN_FIRST_100_EXPECTED = {
  requested_headwords: 100,
  headwords_with_exact_entries: 72,
  headwords_without_exact_entries: 28,
  source_senses: 863,
} as const;

export type OewnSourcePartOfSpeech = 'n' | 'v' | 'a' | 's' | 'r';
export type OewnLearnerPartOfSpeech =
  | 'noun'
  | 'verb'
  | 'adjective'
  | 'adjective_satellite'
  | 'adverb';

export interface OewnCounts {
  lexical_entries: number;
  lemmas: number;
  senses: number;
  synsets: number;
  definitions: number;
  examples: number;
  pronunciations: number;
  forms: number;
  ili_definitions: number;
  sense_relations: number;
  synset_relations: number;
  relations: number;
}

export interface OewnLexiconMetadata {
  id: string;
  label: string;
  language: string;
  email: string;
  license: string;
  version: string;
  url: string;
}

export interface OewnPronunciation {
  value: string;
  variety: string | null;
  notation: string | null;
  phonemic: boolean | null;
  audio: string | null;
  scope: 'lemma' | 'form';
  form: string | null;
}

export interface OewnExample {
  text: string;
  source: string | null;
  scope: 'sense' | 'synset';
}

export interface OewnDefinition {
  text: string;
  sourceSense: string | null;
}

export interface OewnSenseRef {
  id: string;
  synsetId: string;
  sourcePosition: number;
  examples: OewnExample[];
}

export interface OewnLexicalEntry {
  id: string;
  writtenForm: string;
  lookupKey: string;
  sourcePartOfSpeech: OewnSourcePartOfSpeech;
  sourceOrder: number;
  forms: string[];
  pronunciations: OewnPronunciation[];
  senses: OewnSenseRef[];
}

export interface OewnSynsetMember {
  entryId: string;
  writtenForm: string;
  sourcePartOfSpeech: OewnSourcePartOfSpeech;
}

export interface OewnSynset {
  id: string;
  ili: string | null;
  sourcePartOfSpeech: OewnSourcePartOfSpeech;
  lexfile: string | null;
  memberIds: string[];
  members: OewnSynsetMember[];
  definitions: OewnDefinition[];
  examples: OewnExample[];
}

export interface ParsedOewn {
  doctype: string;
  xmlVersion: string;
  xmlEncoding: string | null;
  lexicon: OewnLexiconMetadata;
  counts: OewnCounts;
  uncompressedBytes: number;
  matchingEntries: OewnLexicalEntry[];
  matchingSynsets: Map<string, OewnSynset>;
}

export interface ParseOewnOptions {
  targetLookupKeys?: ReadonlySet<string>;
  expectedCounts?: Partial<OewnCounts>;
  expectedUncompressedBytes?: number;
  maxUncompressedBytes?: number;
  expectedDoctype?: string;
  expectedLexicon?: Partial<OewnLexiconMetadata>;
}

export type OewnHeadwordMatchStatus =
  | 'matched'
  | 'missing'
  | 'case_collision'
  | 'source_lemma_merge';

export interface OewnDefinitionCandidate {
  text: string;
  source_sense_id: string | null;
}

export interface OewnExampleCandidate {
  text: string;
  source: string | null;
  scope: 'sense' | 'synset';
}

export interface OewnPronunciationCandidate {
  value: string;
  variety: string | null;
  notation: string | null;
  phonemic: boolean | null;
  audio: string | null;
  scope: 'lemma' | 'form';
  form: string | null;
}

export interface OewnSenseCandidate {
  candidate_key: string;
  sense_key: string;
  source_sense_id: string;
  source_synset_id: string;
  ili: string | null;
  lexical_entry_id: string;
  entry_lemma: string;
  entry_source_pos: OewnSourcePartOfSpeech;
  synset_source_pos: OewnSourcePartOfSpeech;
  part_of_speech: OewnLearnerPartOfSpeech;
  adjective_satellite: boolean;
  source_entry_order: number;
  source_sense_position: number;
  source_order_is_pedagogical: false;
  lexfile: string | null;
  definitions_en: OewnDefinitionCandidate[];
  examples_en: OewnExampleCandidate[];
  explicit_forms: string[];
  pronunciations: OewnPronunciationCandidate[];
  synset_members: Array<{
    lexical_entry_id: string;
    written_form: string;
    source_pos: OewnSourcePartOfSpeech;
  }>;
  candidate_status: 'unreviewed';
}

export interface OewnHeadwordCandidate {
  headword_key: string;
  priority_order: number;
  normalized_word: string;
  learner_rank: number | null;
  source_memberships: NgslCandidate['sourceMemberships'];
  original_source_lemmas: string[];
  rank_source: string;
  rank_source_version: string;
  rank_source_url: string;
  rank_source_license: string;
  match_status: OewnHeadwordMatchStatus;
  exact_entry_lemmas: string[];
  exact_lexical_entry_ids: string[];
  casefold_only_entry_lemmas: string[];
  semantic_alignment_status: 'unreviewed';
  requires_human_sense_selection: true;
  candidates: OewnSenseCandidate[];
}

export interface OewnCandidateArtifact {
  schema_version: 1;
  artifact_type: 'oewn_ngsl_sense_candidates';
  selection: {
    ngsl_version: string;
    ngsl_candidates_sha256: string;
    priority_from: 1;
    priority_to: number;
    requested_headwords: number;
  };
  source: {
    id: string;
    name: string;
    version: string;
    release_tag: string;
    release_commit: string;
    artifact: string;
    url: string;
    sha256: string;
    license: string;
    license_url: string;
    format: 'WN-LMF 1.3 XML (gzip)';
  };
  review_policy: {
    status: 'source_evidence_only';
    database_import_allowed: false;
    public_display_allowed: false;
    oewn_order_is_learner_order: false;
    exact_source_lemma_matches_only: true;
    required_before_import: string[];
    deliberately_omitted_fields: string[];
  };
  headwords: OewnHeadwordCandidate[];
  summary: {
    requested_headwords: number;
    headwords_with_exact_entries: number;
    headwords_without_exact_entries: number;
    headwords_with_casefold_only_entries: number;
    source_lemma_merges: number;
    exact_lexical_entries: number;
    source_senses: number;
    headwords_with_multiple_source_sense_candidates: number;
    match_status_counts: Record<OewnHeadwordMatchStatus, number>;
  };
}

export const OEWN_HEADWORD_CSV_HEADER = [
  'priority_order',
  'normalized_word',
  'learner_rank',
  'source_memberships',
  'original_source_lemmas',
  'match_status',
  'exact_entry_lemmas',
  'exact_lexical_entry_ids',
  'casefold_only_entry_lemmas',
  'semantic_alignment_status',
  'exact_lexical_entry_count',
  'source_sense_count',
  'requires_human_sense_selection',
  'rank_source',
  'rank_source_version',
  'rank_source_url',
  'rank_source_license',
] as const;

export const OEWN_SENSE_CSV_HEADER = [
  'priority_order',
  'normalized_word',
  'learner_rank',
  'candidate_key',
  'sense_key',
  'source_sense_id',
  'source_synset_id',
  'ili',
  'lexical_entry_id',
  'entry_lemma',
  'entry_source_pos',
  'synset_source_pos',
  'part_of_speech',
  'adjective_satellite',
  'source_entry_order',
  'source_sense_position',
  'source_order_is_pedagogical',
  'lexfile',
  'definitions_en',
  'examples_en',
  'explicit_forms',
  'pronunciations',
  'synset_members',
  'candidate_status',
] as const;

interface EntryMemberMetadata {
  writtenForm: string;
  sourcePartOfSpeech: OewnSourcePartOfSpeech;
}

interface MutableEntry extends OewnLexicalEntry {
  isTarget: boolean;
}

interface MutableSynset extends OewnSynset {
  isTarget: boolean;
}

interface TextCapture {
  element: 'Definition' | 'Example' | 'ILIDefinition' | 'Pronunciation';
  text: string;
  attributes: Record<string, string>;
}

const KNOWN_ELEMENTS = new Set([
  'LexicalResource',
  'Lexicon',
  'LexicalEntry',
  'Lemma',
  'Form',
  'Pronunciation',
  'Tag',
  'Sense',
  'SenseRelation',
  'SyntacticBehaviour',
  'Synset',
  'Definition',
  'Example',
  'ILIDefinition',
  'SynsetRelation',
]);

const EMPTY_COUNTS = (): OewnCounts => ({
  lexical_entries: 0,
  lemmas: 0,
  senses: 0,
  synsets: 0,
  definitions: 0,
  examples: 0,
  pronunciations: 0,
  forms: 0,
  ili_definitions: 0,
  sense_relations: 0,
  synset_relations: 0,
  relations: 0,
});

function attributes(tag: SaxesTagPlain): Record<string, string> {
  return tag.attributes;
}

function requiredAttribute(
  values: Record<string, string>,
  attribute: string,
  element: string,
): string {
  const value = values[attribute];
  if (!value) throw new Error(`OEWN ${element} is missing required ${attribute}`);
  return value;
}

function optionalAttribute(
  values: Record<string, string>,
  attribute: string,
): string | null {
  const value = values[attribute];
  return value === undefined || value === '' ? null : value;
}

function parseOptionalBoolean(
  values: Record<string, string>,
  attribute: string,
  element: string,
): boolean | null {
  const value = optionalAttribute(values, attribute);
  if (value === null) return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`OEWN ${element} has invalid ${attribute}=${JSON.stringify(value)}`);
}

function normalizeSourceText(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

export function normalizeOewnWrittenForm(value: string): string {
  return value.normalize('NFC').trim();
}

export function normalizeOewnLookupKey(value: string): string {
  return normalizeOewnWrittenForm(value).toLocaleLowerCase('en-US');
}

export function mapOewnPartOfSpeech(
  sourcePartOfSpeech: OewnSourcePartOfSpeech,
): OewnLearnerPartOfSpeech {
  switch (sourcePartOfSpeech) {
    case 'n': return 'noun';
    case 'v': return 'verb';
    case 'a': return 'adjective';
    case 's': return 'adjective_satellite';
    case 'r': return 'adverb';
  }
}

function assertSourcePartOfSpeech(value: string, context: string): OewnSourcePartOfSpeech {
  if (!['n', 'v', 'a', 's', 'r'].includes(value)) {
    throw new Error(`OEWN ${context} has unsupported partOfSpeech=${JSON.stringify(value)}`);
  }
  return value as OewnSourcePartOfSpeech;
}

function compatiblePartOfSpeech(
  entry: OewnSourcePartOfSpeech,
  synset: OewnSourcePartOfSpeech,
): boolean {
  return entry === synset || (entry === 'a' && synset === 's');
}

function uniquePreservingOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function assertExpectedCounts(
  actual: OewnCounts,
  expected: Partial<OewnCounts> | undefined,
): void {
  if (!expected) return;
  for (const [field, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[field as keyof OewnCounts];
    if (actualValue !== expectedValue) {
      throw new Error(
        `OEWN ${field} count changed: expected ${expectedValue}, received ${actualValue}`,
      );
    }
  }
}

function assertExpectedLexicon(
  actual: OewnLexiconMetadata,
  expected: Partial<OewnLexiconMetadata> | undefined,
): void {
  if (!expected) return;
  for (const [field, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[field as keyof OewnLexiconMetadata];
    if (actualValue !== expectedValue) {
      throw new Error(
        `OEWN lexicon ${field} changed: expected ${JSON.stringify(expectedValue)}, `
        + `received ${JSON.stringify(actualValue)}`,
      );
    }
  }
}

export async function parseOewnChunks(
  chunks: AsyncIterable<Buffer | string> | Iterable<Buffer | string>,
  options: ParseOewnOptions = {},
): Promise<ParsedOewn> {
  const targetLookupKeys = options.targetLookupKeys ?? new Set<string>();
  const maxUncompressedBytes = options.maxUncompressedBytes ?? 100_000_000;
  const expectedDoctype = options.expectedDoctype ?? OEWN_DOCTYPE;
  const expectedLexicon = options.expectedLexicon ?? {
    id: 'oewn',
    language: 'en',
    license: 'https://creativecommons.org/licenses/by/4.0',
    version: OEWN_VERSION,
    url: 'https://github.com/globalwordnet/english-wordnet',
  };
  const counts = EMPTY_COUNTS();
  const allIds = new Map<string, string>();
  const entryMembers = new Map<string, EntryMemberMetadata>();
  const senseIds = new Set<string>();
  const senseSynsets = new Map<string, string>();
  const synsetIds = new Set<string>();
  const syntacticBehaviourIds = new Set<string>();
  const senseSynsetTargets = new Set<string>();
  const senseRelationTargets = new Set<string>();
  const synsetRelationTargets = new Set<string>();
  const senseSubcatTargets = new Set<string>();
  const syntacticBehaviourSenseTargets = new Set<string>();
  const definitionSourceSenseTargets: Array<{ senseId: string; synsetId: string }> = [];
  const matchingEntries: OewnLexicalEntry[] = [];
  const matchingSynsets = new Map<string, OewnSynset>();
  const targetSynsetIds = new Set<string>();

  let uncompressedBytes = 0;
  let rootCount = 0;
  let lexiconCount = 0;
  let doctype = '';
  let xmlVersion = '';
  let xmlEncoding: string | null = null;
  let lexicon: OewnLexiconMetadata | null = null;
  let currentEntry: MutableEntry | null = null;
  let currentSense: OewnSenseRef | null = null;
  let currentForm: string | null = null;
  let currentSynset: MutableSynset | null = null;
  let currentSynsetDefinitionCount = 0;
  let textCapture: TextCapture | null = null;
  let sawSynset = false;

  const registerId = (id: string, element: string): void => {
    const previousElement = allIds.get(id);
    if (previousElement) {
      throw new Error(
        `OEWN duplicate XML id ${id}: used by both ${previousElement} and ${element}`,
      );
    }
    allIds.set(id, element);
  };

  const parser = new SaxesParser({ xmlns: false, fileName: 'english-wordnet-2025.xml' });
  parser.on('xmldecl', (declaration) => {
    xmlVersion = declaration.version ?? '';
    xmlEncoding = declaration.encoding ?? null;
  });
  parser.on('doctype', (value) => {
    if (doctype) throw new Error('OEWN XML contains more than one DOCTYPE');
    doctype = value.trim();
    if (doctype !== expectedDoctype) {
      throw new Error(
        `OEWN DOCTYPE changed or contains an unsafe internal subset: ${JSON.stringify(doctype)}`,
      );
    }
  });
  parser.on('opentag', (tag) => {
    if (!KNOWN_ELEMENTS.has(tag.name)) {
      throw new Error(`OEWN schema drift: unexpected element <${tag.name}>`);
    }
    const values = attributes(tag);
    const elementId = optionalAttribute(values, 'id');
    if (elementId !== null) registerId(elementId, tag.name);
    switch (tag.name) {
      case 'LexicalResource':
        rootCount += 1;
        break;
      case 'Lexicon': {
        lexiconCount += 1;
        const id = requiredAttribute(values, 'id', 'Lexicon');
        lexicon = {
          id,
          label: requiredAttribute(values, 'label', 'Lexicon'),
          language: requiredAttribute(values, 'language', 'Lexicon'),
          email: requiredAttribute(values, 'email', 'Lexicon'),
          license: requiredAttribute(values, 'license', 'Lexicon'),
          version: requiredAttribute(values, 'version', 'Lexicon'),
          url: requiredAttribute(values, 'url', 'Lexicon'),
        };
        break;
      }
      case 'LexicalEntry': {
        if (sawSynset) {
          throw new Error('OEWN lexical entries must precede synsets for streaming resolution');
        }
        counts.lexical_entries += 1;
        const id = requiredAttribute(values, 'id', 'LexicalEntry');
        currentEntry = {
          id,
          writtenForm: '',
          lookupKey: '',
          sourcePartOfSpeech: 'n',
          sourceOrder: counts.lexical_entries,
          forms: [],
          pronunciations: [],
          senses: [],
          isTarget: false,
        };
        break;
      }
      case 'Lemma': {
        if (!currentEntry) throw new Error('OEWN Lemma appears outside LexicalEntry');
        counts.lemmas += 1;
        const writtenForm = normalizeOewnWrittenForm(
          requiredAttribute(values, 'writtenForm', 'Lemma'),
        );
        const sourcePartOfSpeech = assertSourcePartOfSpeech(
          requiredAttribute(values, 'partOfSpeech', 'Lemma'),
          `Lemma ${writtenForm}`,
        );
        currentEntry.writtenForm = writtenForm;
        currentEntry.lookupKey = normalizeOewnLookupKey(writtenForm);
        currentEntry.sourcePartOfSpeech = sourcePartOfSpeech;
        currentEntry.isTarget = targetLookupKeys.has(currentEntry.lookupKey);
        entryMembers.set(currentEntry.id, { writtenForm, sourcePartOfSpeech });
        break;
      }
      case 'Form':
        counts.forms += 1;
        currentForm = normalizeOewnWrittenForm(
          requiredAttribute(values, 'writtenForm', 'Form'),
        );
        if (currentEntry?.isTarget) currentEntry.forms.push(currentForm);
        break;
      case 'Pronunciation':
        counts.pronunciations += 1;
        textCapture = { element: 'Pronunciation', text: '', attributes: values };
        break;
      case 'Sense': {
        if (!currentEntry) throw new Error('OEWN Sense appears outside LexicalEntry');
        counts.senses += 1;
        const id = requiredAttribute(values, 'id', 'Sense');
        const synsetId = requiredAttribute(values, 'synset', 'Sense');
        senseIds.add(id);
        senseSynsets.set(id, synsetId);
        senseSynsetTargets.add(synsetId);
        const subcat = optionalAttribute(values, 'subcat');
        if (subcat !== null) {
          for (const target of subcat.trim().split(/\s+/u)) senseSubcatTargets.add(target);
        }
        currentSense = {
          id,
          synsetId,
          sourcePosition: currentEntry.senses.length + 1,
          examples: [],
        };
        if (currentEntry.isTarget) {
          currentEntry.senses.push(currentSense);
          targetSynsetIds.add(synsetId);
        }
        break;
      }
      case 'SenseRelation':
        counts.sense_relations += 1;
        senseRelationTargets.add(requiredAttribute(values, 'target', 'SenseRelation'));
        break;
      case 'SyntacticBehaviour': {
        const id = optionalAttribute(values, 'id');
        if (id !== null) {
          syntacticBehaviourIds.add(id);
        }
        requiredAttribute(values, 'subcategorizationFrame', 'SyntacticBehaviour');
        const senses = optionalAttribute(values, 'senses');
        if (senses !== null) {
          for (const target of senses.trim().split(/\s+/u)) {
            syntacticBehaviourSenseTargets.add(target);
          }
        }
        break;
      }
      case 'Synset': {
        sawSynset = true;
        counts.synsets += 1;
        const id = requiredAttribute(values, 'id', 'Synset');
        synsetIds.add(id);
        const sourcePartOfSpeech = assertSourcePartOfSpeech(
          requiredAttribute(values, 'partOfSpeech', 'Synset'),
          `Synset ${id}`,
        );
        const memberIds = requiredAttribute(values, 'members', 'Synset').split(/\s+/u);
        const members = memberIds.map((entryId): OewnSynsetMember => {
          const entry = entryMembers.get(entryId);
          if (!entry) throw new Error(`OEWN Synset ${id} has dangling member ${entryId}`);
          if (!compatiblePartOfSpeech(entry.sourcePartOfSpeech, sourcePartOfSpeech)) {
            throw new Error(
              `OEWN Synset ${id} POS ${sourcePartOfSpeech} conflicts with member `
              + `${entryId} POS ${entry.sourcePartOfSpeech}`,
            );
          }
          return { entryId, ...entry };
        });
        currentSynset = {
          id,
          ili: optionalAttribute(values, 'ili'),
          sourcePartOfSpeech,
          lexfile: optionalAttribute(values, 'lexfile'),
          memberIds,
          members,
          definitions: [],
          examples: [],
          isTarget: targetSynsetIds.has(id),
        };
        currentSynsetDefinitionCount = 0;
        break;
      }
      case 'Definition':
        textCapture = { element: 'Definition', text: '', attributes: values };
        break;
      case 'Example':
        textCapture = { element: 'Example', text: '', attributes: values };
        break;
      case 'ILIDefinition':
        textCapture = { element: 'ILIDefinition', text: '', attributes: values };
        break;
      case 'SynsetRelation':
        counts.synset_relations += 1;
        synsetRelationTargets.add(requiredAttribute(values, 'target', 'SynsetRelation'));
        break;
    }
  });
  parser.on('text', (text) => {
    if (textCapture) textCapture.text += text;
  });
  parser.on('cdata', (text) => {
    if (textCapture) textCapture.text += text;
  });
  parser.on('closetag', (tag) => {
    switch (tag.name) {
      case 'Pronunciation': {
        if (!textCapture || textCapture.element !== 'Pronunciation') {
          throw new Error('OEWN Pronunciation capture state is invalid');
        }
        const value = normalizeSourceText(textCapture.text);
        if (!value) throw new Error('OEWN Pronunciation must not be empty');
        if (currentEntry?.isTarget) {
          currentEntry.pronunciations.push({
            value,
            variety: optionalAttribute(textCapture.attributes, 'variety'),
            notation: optionalAttribute(textCapture.attributes, 'notation'),
            phonemic: parseOptionalBoolean(
              textCapture.attributes,
              'phonemic',
              'Pronunciation',
            ),
            audio: optionalAttribute(textCapture.attributes, 'audio'),
            scope: currentForm === null ? 'lemma' : 'form',
            form: currentForm,
          });
        }
        textCapture = null;
        break;
      }
      case 'Form':
        currentForm = null;
        break;
      case 'Sense':
        currentSense = null;
        break;
      case 'LexicalEntry':
        if (!currentEntry?.writtenForm) {
          throw new Error('OEWN LexicalEntry closed without exactly one usable Lemma');
        }
        if (currentEntry.isTarget) {
          matchingEntries.push({
            id: currentEntry.id,
            writtenForm: currentEntry.writtenForm,
            lookupKey: currentEntry.lookupKey,
            sourcePartOfSpeech: currentEntry.sourcePartOfSpeech,
            sourceOrder: currentEntry.sourceOrder,
            forms: uniquePreservingOrder(currentEntry.forms),
            pronunciations: currentEntry.pronunciations,
            senses: currentEntry.senses,
          });
        }
        currentEntry = null;
        break;
      case 'Definition': {
        if (!textCapture || textCapture.element !== 'Definition' || !currentSynset) {
          throw new Error('OEWN Definition capture state is invalid');
        }
        counts.definitions += 1;
        currentSynsetDefinitionCount += 1;
        const text = normalizeSourceText(textCapture.text);
        if (!text) throw new Error(`OEWN Synset ${currentSynset.id} has an empty Definition`);
        const sourceSense = optionalAttribute(textCapture.attributes, 'sourceSense');
        if (sourceSense !== null) {
          definitionSourceSenseTargets.push({
            senseId: sourceSense,
            synsetId: currentSynset.id,
          });
        }
        if (currentSynset.isTarget) {
          currentSynset.definitions.push({
            text,
            sourceSense,
          });
        }
        textCapture = null;
        break;
      }
      case 'Example': {
        if (!textCapture || textCapture.element !== 'Example') {
          throw new Error('OEWN Example capture state is invalid');
        }
        counts.examples += 1;
        const text = normalizeSourceText(textCapture.text);
        if (!text) throw new Error('OEWN Example must not be empty');
        const example: OewnExample = {
          text,
          source: optionalAttribute(textCapture.attributes, 'dc:source'),
          scope: currentSynset ? 'synset' : 'sense',
        };
        if (currentSynset?.isTarget) currentSynset.examples.push(example);
        else if (currentEntry?.isTarget && currentSense) currentSense.examples.push(example);
        textCapture = null;
        break;
      }
      case 'ILIDefinition':
        if (!textCapture || textCapture.element !== 'ILIDefinition') {
          throw new Error('OEWN ILIDefinition capture state is invalid');
        }
        counts.ili_definitions += 1;
        textCapture = null;
        break;
      case 'Synset':
        if (!currentSynset) throw new Error('OEWN Synset close state is invalid');
        if (currentSynsetDefinitionCount === 0) {
          throw new Error(`OEWN Synset ${currentSynset.id} has no Definition`);
        }
        if (currentSynset.isTarget) {
          matchingSynsets.set(currentSynset.id, {
            id: currentSynset.id,
            ili: currentSynset.ili,
            sourcePartOfSpeech: currentSynset.sourcePartOfSpeech,
            lexfile: currentSynset.lexfile,
            memberIds: currentSynset.memberIds,
            members: currentSynset.members,
            definitions: currentSynset.definitions,
            examples: currentSynset.examples,
          });
        }
        currentSynset = null;
        currentSynsetDefinitionCount = 0;
        break;
    }
  });

  const decoder = new TextDecoder('utf-8', { fatal: true });
  for await (const chunk of chunks) {
    const bytes = typeof chunk === 'string' ? Buffer.byteLength(chunk, 'utf8') : chunk.length;
    uncompressedBytes += bytes;
    if (uncompressedBytes > maxUncompressedBytes) {
      throw new Error(
        `OEWN decompressed input exceeds ${maxUncompressedBytes} byte safety limit`,
      );
    }
    parser.write(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }));
  }
  parser.write(decoder.decode());
  parser.close();

  counts.relations = counts.sense_relations + counts.synset_relations;
  if (!doctype) throw new Error('OEWN XML is missing its pinned DOCTYPE');
  if (rootCount !== 1) throw new Error(`OEWN expected one LexicalResource, received ${rootCount}`);
  if (lexiconCount !== 1 || !lexicon) {
    throw new Error(`OEWN expected one Lexicon, received ${lexiconCount}`);
  }
  if (xmlVersion !== '1.0' || xmlEncoding?.toUpperCase() !== 'UTF-8') {
    throw new Error(
      `OEWN XML declaration changed: version=${JSON.stringify(xmlVersion)} `
      + `encoding=${JSON.stringify(xmlEncoding)}`,
    );
  }
  if (counts.lemmas !== counts.lexical_entries) {
    throw new Error(
      `OEWN requires one Lemma per LexicalEntry; received ${counts.lemmas} lemmas `
      + `for ${counts.lexical_entries} entries`,
    );
  }
  for (const target of senseSynsetTargets) {
    if (!synsetIds.has(target)) throw new Error(`OEWN Sense has dangling synset ${target}`);
  }
  for (const target of senseRelationTargets) {
    if (!senseIds.has(target)) throw new Error(`OEWN SenseRelation has dangling target ${target}`);
  }
  for (const target of synsetRelationTargets) {
    if (!synsetIds.has(target)) throw new Error(`OEWN SynsetRelation has dangling target ${target}`);
  }
  for (const target of senseSubcatTargets) {
    if (!syntacticBehaviourIds.has(target)) {
      throw new Error(`OEWN Sense has dangling subcat SyntacticBehaviour ${target}`);
    }
  }
  for (const target of syntacticBehaviourSenseTargets) {
    if (!senseIds.has(target)) {
      throw new Error(`OEWN SyntacticBehaviour has dangling Sense target ${target}`);
    }
  }
  for (const reference of definitionSourceSenseTargets) {
    const referencedSynset = senseSynsets.get(reference.senseId);
    if (!referencedSynset) {
      throw new Error(`OEWN Definition has dangling sourceSense ${reference.senseId}`);
    }
    if (referencedSynset !== reference.synsetId) {
      throw new Error(
        `OEWN Definition sourceSense ${reference.senseId} belongs to Synset `
        + `${referencedSynset}, not ${reference.synsetId}`,
      );
    }
  }
  for (const target of targetSynsetIds) {
    if (!matchingSynsets.has(target)) {
      throw new Error(`OEWN target Sense references unresolved Synset ${target}`);
    }
  }
  if (
    options.expectedUncompressedBytes !== undefined &&
    uncompressedBytes !== options.expectedUncompressedBytes
  ) {
    throw new Error(
      `OEWN uncompressed byte size changed: expected ${options.expectedUncompressedBytes}, `
      + `received ${uncompressedBytes}`,
    );
  }
  assertExpectedCounts(counts, options.expectedCounts);
  assertExpectedLexicon(lexicon, expectedLexicon);

  return {
    doctype,
    xmlVersion,
    xmlEncoding,
    lexicon,
    counts,
    uncompressedBytes,
    matchingEntries,
    matchingSynsets,
  };
}

function buildSenseCandidate(
  entry: OewnLexicalEntry,
  sense: OewnSenseRef,
  synset: OewnSynset,
): OewnSenseCandidate {
  if (!compatiblePartOfSpeech(entry.sourcePartOfSpeech, synset.sourcePartOfSpeech)) {
    throw new Error(
      `OEWN candidate ${sense.id} has incompatible entry/synset parts of speech`,
    );
  }
  const definitions = synset.definitions.filter(
    (definition) => definition.sourceSense === null || definition.sourceSense === sense.id,
  );
  if (definitions.length === 0) {
    throw new Error(`OEWN candidate ${sense.id} has no applicable English definition`);
  }
  const examples = [...sense.examples, ...synset.examples];
  return {
    candidate_key: `oewn:${OEWN_VERSION}:${sense.id}`,
    sense_key: `oewn:${sense.id}`,
    source_sense_id: sense.id,
    source_synset_id: synset.id,
    ili: synset.ili,
    lexical_entry_id: entry.id,
    entry_lemma: entry.writtenForm,
    entry_source_pos: entry.sourcePartOfSpeech,
    synset_source_pos: synset.sourcePartOfSpeech,
    part_of_speech: mapOewnPartOfSpeech(synset.sourcePartOfSpeech),
    adjective_satellite: synset.sourcePartOfSpeech === 's',
    source_entry_order: entry.sourceOrder,
    source_sense_position: sense.sourcePosition,
    source_order_is_pedagogical: false,
    lexfile: synset.lexfile,
    definitions_en: definitions.map((definition) => ({
      text: definition.text,
      source_sense_id: definition.sourceSense,
    })),
    examples_en: examples.map((example) => ({
      text: example.text,
      source: example.source,
      scope: example.scope,
    })),
    explicit_forms: [...entry.forms],
    pronunciations: entry.pronunciations.map((pronunciation) => ({ ...pronunciation })),
    synset_members: synset.members.map((member) => ({
      lexical_entry_id: member.entryId,
      written_form: member.writtenForm,
      source_pos: member.sourcePartOfSpeech,
    })),
    candidate_status: 'unreviewed',
  };
}

function matchStatus(
  sourceLemmas: readonly string[],
  exactEntries: readonly OewnLexicalEntry[],
  casefoldOnlyEntries: readonly OewnLexicalEntry[],
): OewnHeadwordMatchStatus {
  if (sourceLemmas.length > 1) return 'source_lemma_merge';
  if (exactEntries.length > 0) return 'matched';
  if (casefoldOnlyEntries.length > 0) return 'case_collision';
  return 'missing';
}

export function buildOewnCandidateArtifact(
  ngslCandidates: readonly NgslCandidate[],
  parsed: ParsedOewn,
  options: { limit: number; ngslCandidatesSha256: string },
): OewnCandidateArtifact {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > ngslCandidates.length) {
    throw new Error(`OEWN candidate limit must be between 1 and ${ngslCandidates.length}`);
  }
  if (!/^[a-f0-9]{64}$/u.test(options.ngslCandidatesSha256)) {
    throw new Error('NGSL candidate SHA-256 must be a lowercase 64-character digest');
  }
  const entriesByLookupKey = new Map<string, OewnLexicalEntry[]>();
  for (const entry of parsed.matchingEntries) {
    const entries = entriesByLookupKey.get(entry.lookupKey) ?? [];
    entries.push(entry);
    entriesByLookupKey.set(entry.lookupKey, entries);
  }

  const selected = ngslCandidates.slice(0, options.limit);
  const headwords = selected.map((ngsl, index): OewnHeadwordCandidate => {
    const entries = entriesByLookupKey.get(ngsl.word) ?? [];
    const exactLemmaSet = new Set(ngsl.sourceLemmas);
    const exactEntries = entries.filter((entry) => exactLemmaSet.has(entry.writtenForm));
    const casefoldOnlyEntries = entries.filter((entry) => !exactLemmaSet.has(entry.writtenForm));
    const candidates = exactEntries.flatMap((entry) => entry.senses.map((sense) => {
      const synset = parsed.matchingSynsets.get(sense.synsetId);
      if (!synset) throw new Error(`OEWN candidate ${sense.id} has unresolved Synset ${sense.synsetId}`);
      return buildSenseCandidate(entry, sense, synset);
    }));
    return {
      headword_key: `ngsl:${NGSL_VERSION}:${ngsl.word}`,
      priority_order: index + 1,
      normalized_word: ngsl.word,
      learner_rank: ngsl.rank,
      source_memberships: [...ngsl.sourceMemberships],
      original_source_lemmas: [...ngsl.sourceLemmas],
      rank_source: NGSL_RANK_PROVENANCE.source,
      rank_source_version: NGSL_RANK_PROVENANCE.version,
      rank_source_url: NGSL_RANK_PROVENANCE.url,
      rank_source_license: NGSL_RANK_PROVENANCE.license,
      match_status: matchStatus(ngsl.sourceLemmas, exactEntries, casefoldOnlyEntries),
      exact_entry_lemmas: uniquePreservingOrder(exactEntries.map((entry) => entry.writtenForm)),
      exact_lexical_entry_ids: exactEntries.map((entry) => entry.id),
      casefold_only_entry_lemmas: uniquePreservingOrder(
        casefoldOnlyEntries.map((entry) => entry.writtenForm),
      ),
      semantic_alignment_status: 'unreviewed',
      requires_human_sense_selection: true,
      candidates,
    };
  });
  const matchStatusCounts: Record<OewnHeadwordMatchStatus, number> = {
    matched: 0,
    missing: 0,
    case_collision: 0,
    source_lemma_merge: 0,
  };
  for (const headword of headwords) matchStatusCounts[headword.match_status] += 1;
  const headwordsWithExactEntries = headwords.filter(
    (headword) => headword.candidates.length > 0,
  ).length;

  return {
    schema_version: 1,
    artifact_type: 'oewn_ngsl_sense_candidates',
    selection: {
      ngsl_version: NGSL_VERSION,
      ngsl_candidates_sha256: options.ngslCandidatesSha256,
      priority_from: 1,
      priority_to: options.limit,
      requested_headwords: headwords.length,
    },
    source: {
      id: OEWN_SOURCE_ID,
      name: OEWN_SOURCE_NAME,
      version: OEWN_VERSION,
      release_tag: OEWN_RELEASE_TAG,
      release_commit: OEWN_RELEASE_COMMIT,
      artifact: 'english-wordnet-2025.xml.gz',
      url: OEWN_ARTIFACT_URL,
      sha256: OEWN_SHA256,
      license: OEWN_LICENSE,
      license_url: OEWN_LICENSE_URL,
      format: 'WN-LMF 1.3 XML (gzip)',
    },
    review_policy: {
      status: 'source_evidence_only',
      database_import_allowed: false,
      public_display_allowed: false,
      oewn_order_is_learner_order: false,
      exact_source_lemma_matches_only: true,
      required_before_import: [
        'human learner-sense selection',
        'learner-friendly English definition review',
        'independently authored and approved Vietnamese meaning',
        'independently reviewed bilingual example',
        'explicit learner sense order',
        'separate CEFR evidence if a level is assigned',
      ],
      deliberately_omitted_fields: [
        'definition_vi',
        'cefr_level',
        'learner_sense_order',
        'reviewer',
        'reviewed_at',
        'publication_status',
      ],
    },
    headwords,
    summary: {
      requested_headwords: headwords.length,
      headwords_with_exact_entries: headwordsWithExactEntries,
      headwords_without_exact_entries: headwords.length - headwordsWithExactEntries,
      headwords_with_casefold_only_entries: headwords.filter(
        (headword) => headword.casefold_only_entry_lemmas.length > 0,
      ).length,
      source_lemma_merges: headwords.filter(
        (headword) => headword.original_source_lemmas.length > 1,
      ).length,
      exact_lexical_entries: headwords.reduce(
        (total, headword) => total + headword.exact_lexical_entry_ids.length,
        0,
      ),
      source_senses: headwords.reduce(
        (total, headword) => total + headword.candidates.length,
        0,
      ),
      headwords_with_multiple_source_sense_candidates: headwords.filter(
        (headword) => headword.candidates.length > 1,
      ).length,
      match_status_counts: matchStatusCounts,
    },
  };
}

function renderCsvCell(value: string | number | boolean | null): string {
  const text = value === null ? '' : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

export function renderOewnCandidateJson(artifact: OewnCandidateArtifact): Buffer {
  return Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
}

export function renderOewnHeadwordCsv(artifact: OewnCandidateArtifact): Buffer {
  const rows = artifact.headwords.map((headword) => [
    headword.priority_order,
    headword.normalized_word,
    headword.learner_rank,
    JSON.stringify(headword.source_memberships),
    JSON.stringify(headword.original_source_lemmas),
    headword.match_status,
    JSON.stringify(headword.exact_entry_lemmas),
    JSON.stringify(headword.exact_lexical_entry_ids),
    JSON.stringify(headword.casefold_only_entry_lemmas),
    headword.semantic_alignment_status,
    headword.exact_lexical_entry_ids.length,
    headword.candidates.length,
    headword.requires_human_sense_selection,
    headword.rank_source,
    headword.rank_source_version,
    headword.rank_source_url,
    headword.rank_source_license,
  ].map(renderCsvCell).join(','));
  return Buffer.from(`${OEWN_HEADWORD_CSV_HEADER.join(',')}\n${rows.join('\n')}\n`, 'utf8');
}

export function renderOewnSenseCsv(artifact: OewnCandidateArtifact): Buffer {
  const rows = artifact.headwords.flatMap((headword) => headword.candidates.map((candidate) => [
    headword.priority_order,
    headword.normalized_word,
    headword.learner_rank,
    candidate.candidate_key,
    candidate.sense_key,
    candidate.source_sense_id,
    candidate.source_synset_id,
    candidate.ili,
    candidate.lexical_entry_id,
    candidate.entry_lemma,
    candidate.entry_source_pos,
    candidate.synset_source_pos,
    candidate.part_of_speech,
    candidate.adjective_satellite,
    candidate.source_entry_order,
    candidate.source_sense_position,
    candidate.source_order_is_pedagogical,
    candidate.lexfile,
    JSON.stringify(candidate.definitions_en),
    JSON.stringify(candidate.examples_en),
    JSON.stringify(candidate.explicit_forms),
    JSON.stringify(candidate.pronunciations),
    JSON.stringify(candidate.synset_members),
    candidate.candidate_status,
  ].map(renderCsvCell).join(',')));
  return Buffer.from(`${OEWN_SENSE_CSV_HEADER.join(',')}\n${rows.join('\n')}\n`, 'utf8');
}

export function assertPinnedFirst100Summary(artifact: OewnCandidateArtifact): void {
  for (const [field, expected] of Object.entries(OEWN_FIRST_100_EXPECTED)) {
    const actual = artifact.summary[field as keyof typeof OEWN_FIRST_100_EXPECTED];
    if (actual !== expected) {
      throw new Error(
        `OEWN first-100 ${field} changed: expected ${expected}, received ${actual}`,
      );
    }
  }
}
