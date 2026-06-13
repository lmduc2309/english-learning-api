import { VOICE_CATALOG, isVoiceId, getVoice, publicCatalog } from './voice-catalog';

describe('voice-catalog', () => {
  it('contains the four launch voices with the right engines', () => {
    expect(VOICE_CATALOG.map((v) => v.id).sort()).toEqual([
      'en-aria',
      'en-guy',
      'vi-hoaimi',
      'vi-namminh',
    ]);
    expect(VOICE_CATALOG.find((v) => v.id === 'vi-hoaimi')!.engine).toBe('vieneu');
    expect(VOICE_CATALOG.find((v) => v.id === 'vi-namminh')!.engine).toBe('vieneu');
    expect(VOICE_CATALOG.find((v) => v.id === 'en-aria')!.engine).toBe('piper');
    expect(VOICE_CATALOG.find((v) => v.id === 'en-guy')!.engine).toBe('piper');
  });

  it('every entry has the required fields', () => {
    for (const v of VOICE_CATALOG) {
      expect(typeof v.id).toBe('string');
      expect(['vieneu', 'piper']).toContain(v.engine);
      expect(typeof v.engineVoice).toBe('string');
      expect(v.engineVoice.length).toBeGreaterThan(0);
      expect(['vi-VN', 'en-US']).toContain(v.language);
      expect(['male', 'female']).toContain(v.gender);
      expect(v.label.length).toBeGreaterThan(0);
    }
  });

  it('isVoiceId narrows valid ids and rejects others', () => {
    expect(isVoiceId('vi-hoaimi')).toBe(true);
    expect(isVoiceId('en-aria')).toBe(true);
    expect(isVoiceId('nope')).toBe(false);
    expect(isVoiceId('')).toBe(false);
    expect(isVoiceId(null)).toBe(false);
    expect(isVoiceId(undefined)).toBe(false);
    expect(isVoiceId(42)).toBe(false);
  });

  it('getVoice returns the entry for a valid id', () => {
    expect(getVoice('vi-namminh').engineVoice).toBe('Gia Bảo');
    expect(getVoice('vi-hoaimi').engineVoice).toBe('Ngọc Linh');
    expect(getVoice('en-aria').engineVoice).toBe('en_US-amy-medium');
    expect(getVoice('en-guy').engineVoice).toBe('en_US-ryan-medium');
  });

  it('getVoice throws on unknown id', () => {
    expect(() => getVoice('nope' as never)).toThrow('Unknown voice id: nope');
  });

  it('publicCatalog strips engine and engineVoice (server-only fields)', () => {
    const entries = publicCatalog();
    expect(entries).toHaveLength(VOICE_CATALOG.length);
    for (const entry of entries) {
      expect(entry).not.toHaveProperty('engine');
      expect(entry).not.toHaveProperty('engineVoice');
      expect(entry).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          label: expect.any(String),
          language: expect.any(String),
          gender: expect.any(String),
        }),
      );
    }
  });
});
