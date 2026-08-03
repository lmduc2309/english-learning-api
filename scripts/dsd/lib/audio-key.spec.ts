import * as fs from 'fs';
import * as path from 'path';
import {
  AudioGenerationSpec,
  KEY_COMPONENTS,
  audioSha256,
  canonicalSpokenText,
  inputTextSha256,
  logicalAssetKey,
  parseStorageKey,
  storageKey,
} from './audio-key';

function spec(overrides: Partial<AudioGenerationSpec> = {}): AudioGenerationSpec {
  return {
    text: 'rehearse',
    publicVoiceId: 'en-aria',
    engineVoice: 'en_US-ljspeech-medium',
    engineVersion: '2023.11.14-2',
    modelRevision: '9f967d15e9ccdf43078586d1476ee70f314401bd',
    modelSha256: '6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22',
    runtimeDigest: 'sha256:' + 'a'.repeat(64),
    encoder: { format: 'wav', sampleRate: 22050, channels: 1 },
    ...overrides,
  };
}

describe('canonicalSpokenText', () => {
  it('normalises whitespace and Unicode form', () => {
    expect(canonicalSpokenText('  hello   world \n')).toBe('hello world');
  });

  it('keeps punctuation, because punctuation changes prosody', () => {
    // Folding these would let two genuinely different recordings share a key.
    expect(canonicalSpokenText("Let's go, now!")).toBe("Let's go, now!");
    expect(inputTextSha256('Lets go now')).not.toBe(inputTextSha256("Let's go, now!"));
  });

  it('keeps case, which also changes delivery', () => {
    expect(inputTextSha256('rehearse')).not.toBe(inputTextSha256('REHEARSE'));
  });

  it('is idempotent', () => {
    const once = canonicalSpokenText('  a  b  ');
    expect(canonicalSpokenText(once)).toBe(once);
  });
});

describe('logicalAssetKey', () => {
  it('is stable for the same generation', () => {
    expect(logicalAssetKey(spec())).toBe(logicalAssetKey(spec()));
    expect(logicalAssetKey(spec())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not depend on key order in the spec object', () => {
    const reordered: AudioGenerationSpec = {
      encoder: { channels: 1, sampleRate: 22050, format: 'wav' },
      runtimeDigest: spec().runtimeDigest,
      modelSha256: spec().modelSha256,
      modelRevision: spec().modelRevision,
      engineVersion: spec().engineVersion,
      engineVoice: spec().engineVoice,
      publicVoiceId: spec().publicVoiceId,
      text: spec().text,
    };
    expect(logicalAssetKey(reordered)).toBe(logicalAssetKey(spec()));
  });

  it.each([
    ['the text', { text: 'rehearsed' }],
    ['the public voice', { publicVoiceId: 'en-guy' }],
    ['the engine voice', { engineVoice: 'en_US-norman-medium' }],
    ['the engine version', { engineVersion: '2024.1.1' }],
    ['the model revision', { modelRevision: 'b'.repeat(40) }],
    ['the model bytes', { modelSha256: 'c'.repeat(64) }],
    ['the runtime', { runtimeDigest: 'sha256:' + 'd'.repeat(64) }],
  ])('changes when %s changes', (_label, override) => {
    // A field missing from the key would mean silently reusing a recording made
    // with something else.
    expect(logicalAssetKey(spec(override as Partial<AudioGenerationSpec>))).not.toBe(
      logicalAssetKey(spec()),
    );
  });

  it.each([
    ['the format', { format: 'mp3' as const, sampleRate: 22050, channels: 1 }],
    ['the sample rate', { format: 'wav' as const, sampleRate: 16000, channels: 1 }],
    ['the channel count', { format: 'wav' as const, sampleRate: 22050, channels: 2 }],
    ['the bitrate', { format: 'mp3' as const, sampleRate: 22050, channels: 1, bitrate: '64k' }],
    ['the encoder build', { format: 'wav' as const, sampleRate: 22050, channels: 1, encoder: 'ffmpeg-7.1.5' }],
  ])('changes when %s changes', (_label, encoder) => {
    expect(logicalAssetKey(spec({ encoder }))).not.toBe(logicalAssetKey(spec()));
  });

  it('names every component that can change the waveform', () => {
    // Asserted against the source rather than trusted, because omitting one is
    // silent rather than loud.
    const source = fs.readFileSync(path.resolve(__dirname, 'audio-key.ts'), 'utf8');
    const payload = source.match(/const payload = \{[\s\S]*?\};/)![0];
    for (const component of KEY_COMPONENTS) {
      expect(payload).toContain(component);
    }
  });
});

describe('audioSha256 and storage keys', () => {
  it('hashes bytes, not text', () => {
    expect(audioSha256(Buffer.from([1, 2, 3]))).toMatch(/^[0-9a-f]{64}$/);
    expect(audioSha256(Buffer.from([1, 2, 3]))).not.toBe(audioSha256(Buffer.from([1, 2, 4])));
  });

  it('builds a content-addressed key', () => {
    const hash = 'a'.repeat(64);
    expect(storageKey('en-aria', hash, 'wav')).toBe(`dsd/audio/en-aria/${hash}.wav`);
  });

  it('round-trips', () => {
    const hash = 'b'.repeat(64);
    expect(parseStorageKey(storageKey('en-guy', hash, 'mp3'))).toEqual({
      publicVoiceId: 'en-guy',
      hash,
      format: 'mp3',
    });
  });

  it.each([
    'dsd/audio/en-aria/not-a-hash.wav',
    'dsd/audio/en-aria/aaaa.wav',
    'other/prefix/en-aria/' + 'a'.repeat(64) + '.wav',
    'dsd/audio/en-aria/' + 'a'.repeat(64) + '.flac',
    'dsd/audio/' + 'a'.repeat(64) + '.wav',
  ])('rejects the malformed key %s', (key) => {
    expect(parseStorageKey(key)).toBeNull();
  });

  it('separates the identity of the generation from the identity of the bytes', () => {
    // The whole point: one logical key holding two hashes is a fact to explain,
    // not a file to overwrite.
    const key = logicalAssetKey(spec());
    const first = audioSha256(Buffer.from('take one'));
    const second = audioSha256(Buffer.from('take two'));
    expect(first).not.toBe(second);
    expect(storageKey('en-aria', first, 'wav')).not.toBe(storageKey('en-aria', second, 'wav'));
    expect(key).toBe(logicalAssetKey(spec()));
  });
});
