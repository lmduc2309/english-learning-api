import { VOICE_CATALOG, isVoiceId, getVoice, publicCatalog } from './voice-catalog';

describe('voice-catalog', () => {
  it('contains only the two English voices', () => {
    expect(VOICE_CATALOG.map((v) => v.id).sort()).toEqual(['en-aria', 'en-guy']);
  });

  it('every entry is engine=piper with a Piper voice id', () => {
    for (const v of VOICE_CATALOG) {
      expect(v.engine).toBe('piper');
      expect(v.engineVoice).toMatch(/^en_US-(amy|ryan)-medium$/);
      expect(v.language).toBe('en-US');
      expect(['male', 'female']).toContain(v.gender);
      expect(v.label.length).toBeGreaterThan(0);
    }
  });

  it('isVoiceId accepts the two English ids, rejects others', () => {
    expect(isVoiceId('en-aria')).toBe(true);
    expect(isVoiceId('en-guy')).toBe(true);
    expect(isVoiceId('vi-hoaimi')).toBe(false);
    expect(isVoiceId('vi-namminh')).toBe(false);
    expect(isVoiceId('nope')).toBe(false);
    expect(isVoiceId(null)).toBe(false);
    expect(isVoiceId(undefined)).toBe(false);
    expect(isVoiceId(42)).toBe(false);
  });

  it('getVoice resolves to the correct Piper voice', () => {
    expect(getVoice('en-aria').engineVoice).toBe('en_US-amy-medium');
    expect(getVoice('en-aria').label).toBe('Amy');
    expect(getVoice('en-guy').engineVoice).toBe('en_US-ryan-medium');
    expect(getVoice('en-guy').label).toBe('Ryan');
  });

  it('getVoice throws on unknown id', () => {
    expect(() => getVoice('nope' as never)).toThrow('Unknown voice id: nope');
  });

  it('publicCatalog strips engine and engineVoice', () => {
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
