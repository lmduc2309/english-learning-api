/**
 * Shapes DSD rows into the public response.
 *
 * The field names match what the existing dictionary endpoint already returns,
 * so clients do not have to change when traffic moves to DSD. What changes is
 * content identity: `id` is a DSD UUID, and there is no legacy integer anywhere
 * in the output.
 *
 * This file is an allowlist, not a transformation. It names every field it
 * emits, so a column added to a serving view later cannot appear in a response
 * because somebody spread an object — which is how internal fields leak.
 */
import { DsdEntryAggregate, DsdSearchHit } from './dsd-query.service';

export interface DsdPublicExample {
  en: string;
  vi: string;
}

export interface DsdPublicRelation {
  type: string;
  word: string;
  sense_id: string;
}

export interface DsdPublicDefinition {
  id: string;
  part_of_speech: string;
  definition_en: string;
  definition_vi: string;
  usage_labels: string[];
  examples: DsdPublicExample[];
  /** Approved DSD relations only. Never a borrowed relation set. */
  relations: DsdPublicRelation[];
}

export interface DsdPublicPronunciation {
  accent: string;
  ipa: string;
  audio_url: string | null;
}

export interface DsdPublicEntry {
  id: string;
  word: string;
  pronunciations: DsdPublicPronunciation[];
  definitions: DsdPublicDefinition[];
  data_source: 'dsd';
  corpus_release_id: string;
  updated_at: string;
}

export interface DsdPublicSearchHit {
  id: string;
  word: string;
  part_of_speech: string;
  definition_en: string;
  definition_vi: string | null;
}

/**
 * Build the audio URL a client will fetch.
 *
 * A URL, never a bucket path: the storage key is an internal detail and the
 * serving role cannot list the bucket anyway. MP3 is preferred over WAV because
 * it is the serving format; WAV is the canonical master.
 */
export function audioUrl(
  publicBaseUrl: string,
  audio: Array<{ storageKey: string; format: string }>,
): string | null {
  if (!publicBaseUrl || audio.length === 0) return null;
  const chosen = audio.find((item) => item.format === 'mp3') ?? audio[0];
  return `${publicBaseUrl.replace(/\/$/, '')}/${chosen.storageKey}`;
}

export interface PresenterOptions {
  /** Stamped on every response so a cached body names the corpus it came from. */
  releaseId: string;
  audioBaseUrl: string;
}

export function presentEntry(
  aggregate: DsdEntryAggregate,
  options: PresenterOptions,
): DsdPublicEntry {
  return {
    id: aggregate.entry.id,
    word: aggregate.entry.headword,
    pronunciations: aggregate.pronunciations.map((pronunciation) => ({
      accent: pronunciation.accent,
      ipa: pronunciation.ipa,
      audio_url: audioUrl(options.audioBaseUrl, pronunciation.audio),
    })),
    definitions: aggregate.senses.map((sense) => ({
      id: sense.id,
      part_of_speech: sense.partOfSpeech,
      definition_en: sense.definitionEn,
      // Completeness is enforced by the query service, so a served entry always
      // has Vietnamese. The fallback keeps the type honest rather than pretending.
      definition_vi: sense.translations.find((t) => t.locale === 'vi')?.text ?? '',
      usage_labels: sense.usageLabels ?? [],
      examples: sense.examples.map((example) => ({
        en: example.exampleEn,
        vi: example.exampleVi,
      })),
      relations: (sense.relations ?? []).map((relation) => ({
        type: relation.relationType,
        word: relation.relatedHeadword,
        sense_id: relation.relatedSenseId,
      })),
    })),
    data_source: 'dsd',
    corpus_release_id: options.releaseId,
    updated_at: new Date(aggregate.entry.updatedAt).toISOString(),
  };
}

export function presentSearchHits(hits: DsdSearchHit[]): DsdPublicSearchHit[] {
  return hits.map((hit) => ({
    id: hit.id,
    word: hit.headword,
    part_of_speech: hit.partOfSpeech,
    definition_en: hit.definitionEn,
    definition_vi: hit.translationVi,
  }));
}

/**
 * Field names that must never appear in a public response.
 *
 * Asserted by a test against real presented output. The serving views already
 * omit these columns, so this is defence in depth — but the presenter is the
 * layer a future change is most likely to pass through carelessly.
 */
export const FORBIDDEN_RESPONSE_FIELDS = [
  'authored_by', 'authoredBy', 'reviewed_by', 'reviewedBy', 'decided_by',
  'batch_id', 'batchId', 'content_sha256', 'contentSha256',
  'source_id', 'sourceId', 'rights_evidence_id', 'evidence_id',
  'similarity', 'match_class', 'matchClass', 'component_scores',
  'legacy_digest', 'candidate_ipa', 'qa_findings', 'review_notes',
  'word_id', 'wordId', 'definition_id', 'legacy_id', 'storage_key', 'storageKey',
  'status', 'review_status', 'reviewStatus',
] as const;
