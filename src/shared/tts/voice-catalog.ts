export type Engine = 'piper';

export interface VoiceCatalogEntry {
  id: string;
  engine: Engine;
  engineVoice: string;
  label: string;
  language: 'en-US';
  gender: 'male' | 'female';
}

/**
 * The two approved voices.
 *
 * `id` is an opaque identifier and is deliberately unchanged: clients and saved
 * local-storage preferences use it. `label` is what a user sees, and it names
 * neither the model, the dataset, nor a person — DSD cannot claim whose voice a
 * synthetic replica is while performer rights are unresolved, and implying live
 * human speech would misrepresent synthetic audio.
 *
 * `engineVoice` is the model the TTS service loads. It never leaves the server:
 * publicCatalog() strips it, and a test asserts that.
 */
export const VOICE_CATALOG = [
  { id: 'en-aria', engine: 'piper', engineVoice: 'en_US-ljspeech-medium', label: 'DSD Female', language: 'en-US', gender: 'female' },
  { id: 'en-guy',  engine: 'piper', engineVoice: 'en_US-norman-medium',   label: 'DSD Male',   language: 'en-US', gender: 'male'   },
] as const satisfies readonly VoiceCatalogEntry[];

/**
 * Models that must never appear in the catalogue.
 *
 * Amy's training dataset bars commercial redistribution of derived models;
 * Ryan's is CC BY-NC-SA. Named here rather than deleted so a test can prove
 * they were rejected instead of merely forgotten — see
 * ../../../tts-service/docs/DSD-VOICE-RIGHTS.md.
 */
export const BLOCKED_ENGINE_VOICES = ['en_US-amy-medium', 'en_US-ryan-medium'] as const;

export type VoiceId = (typeof VOICE_CATALOG)[number]['id'];

export function isVoiceId(value: unknown): value is VoiceId {
  return typeof value === 'string' && VOICE_CATALOG.some((v) => v.id === value);
}

export function getVoice(id: VoiceId): VoiceCatalogEntry {
  const voice = VOICE_CATALOG.find((v) => v.id === id);
  if (!voice) throw new Error(`Unknown voice id: ${id}`);
  return voice;
}

export function publicCatalog(): Array<Omit<VoiceCatalogEntry, 'engine' | 'engineVoice'>> {
  return VOICE_CATALOG.map(
    ({ engine: _e, engineVoice: _ev, ...rest }) => rest,
  );
}
