export interface VoiceCatalogEntry {
  id: string;
  azureName: string;
  label: string;
  language: 'vi-VN' | 'en-US';
  gender: 'male' | 'female';
}

export const VOICE_CATALOG = [
  { id: 'vi-hoaimi',  azureName: 'vi-VN-HoaiMyNeural',  label: 'Hoài My',  language: 'vi-VN', gender: 'female' },
  { id: 'vi-namminh', azureName: 'vi-VN-NamMinhNeural', label: 'Nam Minh', language: 'vi-VN', gender: 'male'   },
  { id: 'en-aria',    azureName: 'en-US-AriaNeural',    label: 'Aria',     language: 'en-US', gender: 'female' },
  { id: 'en-guy',     azureName: 'en-US-GuyNeural',     label: 'Guy',      language: 'en-US', gender: 'male'   },
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

export function publicCatalog(): Array<Omit<VoiceCatalogEntry, 'azureName'>> {
  return VOICE_CATALOG.map(({ azureName: _omit, ...rest }) => rest);
}
