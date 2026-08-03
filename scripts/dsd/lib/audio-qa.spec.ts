import * as crypto from 'crypto';
import {
  QaExpectation,
  WavParseError,
  checkAudio,
  findDuplicateAudio,
  parseWav,
} from './audio-qa';

/** Build a 16-bit mono PCM WAV. Amplitude 0..1, duration in milliseconds. */
function wav(options: {
  ms?: number;
  sampleRate?: number;
  channels?: number;
  amplitude?: number;
  leadingSilenceMs?: number;
  trailingSilenceMs?: number;
  extraChunk?: string;
} = {}): Buffer {
  const sampleRate = options.sampleRate ?? 22050;
  const channels = options.channels ?? 1;
  const ms = options.ms ?? 1000;
  const amplitude = options.amplitude ?? 0.4;
  const lead = Math.round(((options.leadingSilenceMs ?? 0) / 1000) * sampleRate);
  const trail = Math.round(((options.trailingSilenceMs ?? 0) / 1000) * sampleRate);
  const frames = Math.round((ms / 1000) * sampleRate);

  const data = Buffer.alloc(frames * channels * 2);
  for (let frame = 0; frame < frames; frame++) {
    const audible = frame >= lead && frame < frames - trail;
    // A sine so the RMS is a realistic fraction of the peak.
    const value = audible
      ? Math.round(Math.sin((frame / sampleRate) * 2 * Math.PI * 220) * amplitude * 32767)
      : 0;
    for (let channel = 0; channel < channels; channel++) {
      data.writeInt16LE(Math.max(-32768, Math.min(32767, value)), (frame * channels + channel) * 2);
    }
  }

  const extra = options.extraChunk
    ? (() => {
        const body = Buffer.from('encoder=test', 'ascii');
        const chunk = Buffer.alloc(8 + body.length + (body.length % 2));
        chunk.write(options.extraChunk!.padEnd(4), 0, 'ascii');
        chunk.writeUInt32LE(body.length, 4);
        body.copy(chunk, 8);
        return chunk;
      })()
    : Buffer.alloc(0);

  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0, 'ascii');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(channels, 10);
  fmt.writeUInt32LE(sampleRate, 12);
  fmt.writeUInt32LE(sampleRate * channels * 2, 16);
  fmt.writeUInt16LE(channels * 2, 20);
  fmt.writeUInt16LE(16, 22);

  const dataHeader = Buffer.alloc(8);
  dataHeader.write('data', 0, 'ascii');
  dataHeader.writeUInt32LE(data.length, 4);

  const body = Buffer.concat([fmt, extra, dataHeader, data]);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(4 + body.length, 4);
  riff.write('WAVE', 8, 'ascii');
  return Buffer.concat([riff, body]);
}

const sha = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');

function expectation(bytes: Buffer, overrides: Partial<QaExpectation> = {}): QaExpectation {
  return {
    sampleRate: 22050,
    channels: 1,
    format: 'wav',
    expectedSha256: sha(bytes),
    actualSha256: sha(bytes),
    spokenText: 'Hello, this is a DSD pronunciation sample.',
    ...overrides,
  };
}

const rules = (findings: { rule: string }[]) => findings.map((f) => f.rule);

describe('parseWav', () => {
  it('measures a well-formed clip', () => {
    const info = parseWav(wav({ ms: 1000 }));
    expect(info.sampleRate).toBe(22050);
    expect(info.channels).toBe(1);
    expect(info.durationMs).toBe(1000);
    expect(info.peak).toBeGreaterThan(0.35);
    expect(info.rms).toBeGreaterThan(0.2);
  });

  it('refuses a truncated file rather than decoding what arrived', () => {
    const bytes = wav();
    expect(() => parseWav(bytes.subarray(0, bytes.length - 500))).toThrow(WavParseError);
  });

  it.each([
    ['no RIFF marker', Buffer.concat([Buffer.from('XXXX'), wav().subarray(4)])],
    ['too short to hold a header', Buffer.alloc(20)],
  ])('rejects %s', (_label, bytes) => {
    expect(() => parseWav(bytes)).toThrow(WavParseError);
  });

  it('measures leading and trailing silence', () => {
    const info = parseWav(wav({ ms: 2000, leadingSilenceMs: 900, trailingSilenceMs: 400 }));
    expect(info.leadingSilenceMs).toBeGreaterThan(850);
    expect(info.trailingSilenceMs).toBeGreaterThan(350);
  });

  it('reports chunks a bare PCM WAV does not need', () => {
    expect(parseWav(wav({ extraChunk: 'LIST' })).extraChunks).toContain('LIST');
  });
});

describe('checkAudio', () => {
  it('passes a clean clip', () => {
    const bytes = wav({ ms: 3400 });
    expect(checkAudio(bytes, expectation(bytes))).toEqual([]);
  });

  it('reports a hash mismatch first and measures nothing else', () => {
    // The bytes are not the bytes on record, so no other measurement describes
    // the asset in the database.
    const bytes = wav();
    const findings = checkAudio(bytes, expectation(bytes, { expectedSha256: 'a'.repeat(64) }));
    expect(rules(findings)).toEqual(['hash_mismatch']);
  });

  it('flags an empty object', () => {
    const empty = Buffer.alloc(0);
    expect(rules(checkAudio(empty, expectation(empty)))).toContain('empty_object');
  });

  it('flags a clip that will not decode', () => {
    const bytes = Buffer.from('not audio at all, just text');
    expect(rules(checkAudio(bytes, expectation(bytes)))).toContain('not_decodable');
  });

  it('flags silence', () => {
    const bytes = wav({ ms: 2000, amplitude: 0 });
    expect(rules(checkAudio(bytes, expectation(bytes)))).toContain('silent');
  });

  it('flags clipping', () => {
    const bytes = wav({ ms: 1000, amplitude: 1.5 });
    expect(rules(checkAudio(bytes, expectation(bytes)))).toContain('clipping');
  });

  it('flags the wrong sample rate and channel count', () => {
    const bytes = wav({ sampleRate: 16000, channels: 2 });
    const findings = rules(checkAudio(bytes, expectation(bytes)));
    expect(findings).toContain('sample_rate');
    expect(findings).toContain('channel_count');
  });

  it('flags a clip that is too short or too long', () => {
    const short = wav({ ms: 100 });
    expect(rules(checkAudio(short, expectation(short)))).toContain('too_short');
    const long = wav({ ms: 31000 });
    expect(rules(checkAudio(long, expectation(long)))).toContain('too_long');
  });

  it('flags excessive leading and trailing silence', () => {
    const bytes = wav({ ms: 4000, leadingSilenceMs: 900, trailingSilenceMs: 1500 });
    const findings = rules(checkAudio(bytes, expectation(bytes)));
    expect(findings).toContain('leading_silence');
    expect(findings).toContain('trailing_silence');
  });

  it('flags metadata that would make output non-reproducible', () => {
    const bytes = wav({ extraChunk: 'LIST' });
    expect(rules(checkAudio(bytes, expectation(bytes)))).toContain('unexpected_metadata');
  });

  it('flags audio far too brief for the text it claims to speak', () => {
    // Duration alone passes; nine words in 300 ms does not.
    const bytes = wav({ ms: 300 });
    expect(
      rules(
        checkAudio(
          bytes,
          expectation(bytes, { spokenText: 'one two three four five six seven eight nine' }),
        ),
      ),
    ).toContain('input_mismatch');
  });

  it('reports every finding, not the first', () => {
    const bytes = wav({ ms: 100, sampleRate: 16000, amplitude: 0 });
    expect(rules(checkAudio(bytes, expectation(bytes))).length).toBeGreaterThan(2);
  });
});

describe('checkAudio for mp3', () => {
  it('accepts a bare MPEG frame', () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(2000)]);
    expect(checkAudio(bytes, expectation(bytes, { format: 'mp3' }))).toEqual([]);
  });

  it('flags an ID3 tag, which carries an encoder name and a timestamp', () => {
    const bytes = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(2000)]);
    expect(rules(checkAudio(bytes, expectation(bytes, { format: 'mp3' })))).toContain(
      'unexpected_metadata',
    );
  });

  it('flags bytes that are not MP3 at all', () => {
    const bytes = Buffer.from('still not audio');
    expect(rules(checkAudio(bytes, expectation(bytes, { format: 'mp3' })))).toContain(
      'not_decodable',
    );
  });
});

describe('findDuplicateAudio', () => {
  it('flags one recording serving two different inputs', () => {
    // The engine ignored the text. Invisible per-asset, obvious across a batch.
    const findings = findDuplicateAudio([
      { id: 'a1', audioSha256: 'a'.repeat(64), inputTextSha256: '1'.repeat(64) },
      { id: 'a2', audioSha256: 'a'.repeat(64), inputTextSha256: '2'.repeat(64) },
    ]);
    expect(rules(findings)).toContain('duplicate_audio');
    expect(findings[0].detail).toContain('a1');
    expect(findings[0].detail).toContain('a2');
  });

  it('does not flag the same input generated twice', () => {
    // Same text, same bytes: that is determinism working.
    expect(
      findDuplicateAudio([
        { id: 'a1', audioSha256: 'a'.repeat(64), inputTextSha256: '1'.repeat(64) },
        { id: 'a2', audioSha256: 'a'.repeat(64), inputTextSha256: '1'.repeat(64) },
      ]),
    ).toEqual([]);
  });

  it('does not flag distinct recordings', () => {
    expect(
      findDuplicateAudio([
        { id: 'a1', audioSha256: 'a'.repeat(64), inputTextSha256: '1'.repeat(64) },
        { id: 'a2', audioSha256: 'b'.repeat(64), inputTextSha256: '2'.repeat(64) },
      ]),
    ).toEqual([]);
  });
});
