export type Engine = 'vieneu' | 'piper';

export interface VoiceCatalogEntry {
  id: string;
  engine: Engine;
  engineVoice: string;
  label: string;
  language: 'vi-VN' | 'en-US';
  gender: 'male' | 'female';
}

export const VOICE_CATALOG = [
  { id: 'vi-hoaimi',  engine: 'vieneu', engineVoice: 'Ngọc Linh',         label: 'Ngọc Linh', language: 'vi-VN', gender: 'female' },
  { id: 'vi-namminh', engine: 'vieneu', engineVoice: 'Gia Bảo',           label: 'Gia Bảo',   language: 'vi-VN', gender: 'male'   },
  { id: 'en-aria',    engine: 'piper',  engineVoice: 'en_US-amy-medium',  label: 'Amy',       language: 'en-US', gender: 'female' },
  { id: 'en-guy',     engine: 'piper',  engineVoice: 'en_US-ryan-medium', label: 'Ryan',      language: 'en-US', gender: 'male'   },
] as const satisfies readonly VoiceCatalogEntry[];

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
