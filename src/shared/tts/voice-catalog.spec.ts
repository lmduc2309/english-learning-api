import {
  BLOCKED_ENGINE_VOICES,
  VOICE_CATALOG,
  isVoiceId,
  getVoice,
  publicCatalog,
} from './voice-catalog';

describe('voice-catalog', () => {
  it('contains only the two English voices', () => {
    expect(VOICE_CATALOG.map((v) => v.id).sort()).toEqual(['en-aria', 'en-guy']);
  });

  it('every entry is engine=piper with a Piper voice id', () => {
    for (const v of VOICE_CATALOG) {
      expect(v.engine).toBe('piper');
      expect(v.engineVoice).toMatch(/^en_US-(ljspeech|norman)-medium$/);
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
    expect(getVoice('en-aria').engineVoice).toBe('en_US-ljspeech-medium');
    expect(getVoice('en-aria').label).toBe('DSD Female');
    expect(getVoice('en-guy').engineVoice).toBe('en_US-norman-medium');
    expect(getVoice('en-guy').label).toBe('DSD Male');
  });

  it('keeps the opaque ids clients and local storage already use', () => {
    // Changing these would silently reset every saved voice preference.
    expect(VOICE_CATALOG.map((v) => v.id)).toEqual(['en-aria', 'en-guy']);
  });

  it.each(BLOCKED_ENGINE_VOICES)('never maps to the rejected voice %s', (blocked) => {
    // Amy's dataset bars commercial redistribution of derived models; Ryan's is
    // CC BY-NC-SA. Named so this proves rejection rather than forgetting.
    expect(VOICE_CATALOG.map((v) => v.engineVoice)).not.toContain(blocked);
  });

  it('shows a label that names neither the model, the dataset, nor a person', () => {
    // DSD cannot claim whose voice a synthetic replica is while performer
    // rights are unresolved, and implying live speech would misrepresent it.
    for (const entry of VOICE_CATALOG) {
      const label = entry.label.toLowerCase();
      for (const forbidden of ['amy', 'ryan', 'ljspeech', 'norman', 'aria', 'guy', 'librivox']) {
        expect(label).not.toContain(forbidden);
      }
      expect(label).not.toMatch(/real|human|live|actor|recorded/);
    }
  });

  it('getVoice throws on unknown id', () => {
    expect(() => getVoice('nope' as never)).toThrow('Unknown voice id: nope');
  });

  it('never exposes the model name in a response', () => {
    // The model is a server-side implementation detail. Leaking it would be the
    // same claim the neutral label exists to avoid.
    const serialized = JSON.stringify(publicCatalog());
    for (const entry of VOICE_CATALOG) {
      expect(serialized).not.toContain(entry.engineVoice);
    }
    expect(serialized).not.toMatch(/ljspeech|norman|amy|ryan/i);
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
