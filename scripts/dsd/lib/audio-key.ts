/**
 * The identity of an audio generation, separate from the identity of its bytes.
 *
 * The logical asset key answers "was this the same generation?" and the audio
 * hash answers "were these the same bytes?". Keeping them apart is what makes a
 * non-deterministic encoder visible: one logical key yielding two hashes is a
 * fact to explain, not a file to replace. Collapsing them would turn that into
 * two unrelated assets and nobody would notice.
 *
 * Everything that can change the waveform goes into the key. If a field is
 * missing here, changing it would silently reuse an old recording.
 */
import * as crypto from 'crypto';

export const AUDIO_KEY_VERSION = 1;

/** Encoder settings that affect the output. Pinned, and part of the identity. */
export interface EncoderSpec {
  /** 'wav' is the canonical master; 'mp3' is derived for serving. */
  format: 'wav' | 'mp3';
  bitrate?: string;
  sampleRate: number;
  channels: number;
  /** ffmpeg build that produced it, when the format needs an encoder. */
  encoder?: string;
}

export interface AudioGenerationSpec {
  /** Canonical text actually sent to the engine. */
  text: string;
  publicVoiceId: string;
  engineVoice: string;
  engineVersion: string;
  modelRevision: string;
  modelSha256: string;
  /** The container that produced it. Different runtime, different identity. */
  runtimeDigest: string;
  encoder: EncoderSpec;
}

/**
 * Canonicalize the text that will be spoken.
 *
 * Deliberately gentler than the comparison normalizer in lib/similarity: an
 * apostrophe or a comma changes prosody, so folding them would let two
 * genuinely different recordings share a key. Only whitespace and Unicode form
 * are normalised, because those do not change what the engine says.
 */
export function canonicalSpokenText(value: string): string {
  return (value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

export function inputTextSha256(value: string): string {
  return crypto
    .createHash('sha256')
    .update(`dsd.audio.input.v${AUDIO_KEY_VERSION} ${canonicalSpokenText(value)}`, 'utf8')
    .digest('hex');
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

/**
 * Identity of the generation. Same inputs and same locked stack produce the
 * same key, on any machine, in any order.
 */
export function logicalAssetKey(spec: AudioGenerationSpec): string {
  const payload = {
    version: AUDIO_KEY_VERSION,
    inputTextSha256: inputTextSha256(spec.text),
    publicVoiceId: spec.publicVoiceId,
    engineVoice: spec.engineVoice,
    engineVersion: spec.engineVersion,
    modelRevision: spec.modelRevision,
    modelSha256: spec.modelSha256,
    runtimeDigest: spec.runtimeDigest,
    encoder: spec.encoder,
  };
  return crypto
    .createHash('sha256')
    .update(`dsd.audio.key.v${AUDIO_KEY_VERSION} ${JSON.stringify(canonical(payload))}`, 'utf8')
    .digest('hex');
}

export function audioSha256(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/** Content-addressed, and the shape the database CHECK enforces. */
export function storageKey(publicVoiceId: string, hash: string, format: 'wav' | 'mp3'): string {
  return `dsd/audio/${publicVoiceId}/${hash}.${format}`;
}

const STORAGE_KEY_RE = /^dsd\/audio\/([a-z0-9-]+)\/([0-9a-f]{64})\.(wav|mp3)$/;

export function parseStorageKey(
  key: string,
): { publicVoiceId: string; hash: string; format: 'wav' | 'mp3' } | null {
  const match = STORAGE_KEY_RE.exec(key ?? '');
  if (!match) return null;
  return { publicVoiceId: match[1], hash: match[2], format: match[3] as 'wav' | 'mp3' };
}

/**
 * The fields that must appear in the key.
 *
 * Asserted by a test rather than trusted, because the failure mode of omitting
 * one is silent reuse of a recording made with something else.
 */
export const KEY_COMPONENTS = [
  'inputTextSha256',
  'publicVoiceId',
  'engineVoice',
  'engineVersion',
  'modelRevision',
  'modelSha256',
  'runtimeDigest',
  'encoder',
] as const;
