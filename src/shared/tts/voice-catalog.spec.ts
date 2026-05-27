import { VOICE_CATALOG, isVoiceId, getVoice, publicCatalog } from './voice-catalog';

describe('voice-catalog', () => {
  it('contains the four launch voices', () => {
    const ids = VOICE_CATALOG.map((v) => v.id).sort();
    expect(ids).toEqual(['en-aria', 'en-guy', 'vi-hoaimi', 'vi-namminh']);
  });

  it('every entry has the required fields', () => {
    for (const v of VOICE_CATALOG) {
      expect(typeof v.id).toBe('string');
      expect(v.azureName).toMatch(/Neural$/);
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
    expect(getVoice('vi-hoaimi').azureName).toBe('vi-VN-HoaiMyNeural');
  });

  it('getVoice throws on unknown id', () => {
    expect(() => getVoice('nope' as never)).toThrow('Unknown voice id: nope');
  });

  it('publicCatalog strips azureName', () => {
    const entries = publicCatalog();
    expect(entries).toHaveLength(VOICE_CATALOG.length);
    for (const entry of entries) {
      expect(entry).not.toHaveProperty('azureName');
      expect(entry).toEqual(
        expect.objectContaining({ id: expect.any(String), label: expect.any(String), language: expect.any(String), gender: expect.any(String) }),
      );
    }
  });
});
