import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  BLOCKED_ENGINE_VOICES,
  GenerationInput,
  LockedVoice,
  assetEligibility,
  buildAsset,
  readVoiceLock,
  refuseVoice,
} from './audio-generate';
import { logicalAssetKey } from './lib/audio-key';

const RUNTIME = 'sha256:' + 'a'.repeat(64);

function wav(ms = 1000, sampleRate = 22050, amplitude = 0.4): Buffer {
  const frames = Math.round((ms / 1000) * sampleRate);
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    data.writeInt16LE(
      Math.round(Math.sin((i / sampleRate) * 2 * Math.PI * 220) * amplitude * 32767),
      i * 2,
    );
  }
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0, 'ascii');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(sampleRate, 12);
  fmt.writeUInt32LE(sampleRate * 2, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);
  const header = Buffer.alloc(8);
  header.write('data', 0, 'ascii');
  header.writeUInt32LE(data.length, 4);
  const body = Buffer.concat([fmt, header, data]);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(4 + body.length, 4);
  riff.write('WAVE', 8, 'ascii');
  return Buffer.concat([riff, body]);
}

function voice(overrides: Partial<LockedVoice> = {}): LockedVoice {
  return {
    publicVoiceId: 'en-aria',
    engineVoice: 'en_US-ljspeech-medium',
    modelRevision: '9f967d15e9ccdf43078586d1476ee70f314401bd',
    modelSha256: 'f'.repeat(64),
    modelLicense: 'MIT',
    trainingDataset: 'LJ Speech',
    trainingDatasetStatus: 'approved',
    ...overrides,
  };
}

function input(overrides: Partial<GenerationInput> = {}): GenerationInput {
  return {
    entryId: '11111111-1111-1111-1111-111111111111',
    pronunciationId: '22222222-2222-2222-2222-222222222222',
    spokenText: 'rehearse',
    voice: voice(),
    engineVersion: '2023.11.14-2',
    encoder: { format: 'wav', sampleRate: 22050, channels: 1 },
    runtimeDigest: RUNTIME,
    expectedRuntimeDigest: RUNTIME,
    bytes: wav(),
    ...overrides,
  };
}

describe('refuseVoice', () => {
  const locked = [voice(), voice({ publicVoiceId: 'en-guy', engineVoice: 'en_US-norman-medium' })];

  it('allows a locked voice', () => {
    expect(refuseVoice('en_US-ljspeech-medium', locked)).toEqual([]);
  });

  it.each(BLOCKED_ENGINE_VOICES)('refuses %s by name', (blocked) => {
    const refusals = refuseVoice(blocked, locked);
    expect(refusals.length).toBeGreaterThan(0);
    expect(refusals.map((r) => r.reason).join(' ')).toMatch(/blocked/);
  });

  it('refuses a blocked voice even if somebody added it to the lock', () => {
    // Belt and braces: the name check does not depend on the lock being right.
    const tampered = [...locked, voice({ engineVoice: 'en_US-amy-medium' })];
    expect(refuseVoice('en_US-amy-medium', tampered).map((r) => r.reason).join(' ')).toMatch(
      /blocked/,
    );
  });

  it('refuses a voice absent from the lock', () => {
    expect(refuseVoice('en_US-someone-medium', locked).map((r) => r.reason).join(' ')).toMatch(
      /no recorded provenance/,
    );
  });

  it('refuses a locked voice with no model digest', () => {
    const incomplete = [voice({ modelSha256: '' })];
    expect(refuseVoice('en_US-ljspeech-medium', incomplete).map((r) => r.reason).join(' ')).toMatch(
      /no model digest/,
    );
  });
});

const externalVoiceLockPath = path.resolve(
  __dirname,
  '../../../tts-service/models/piper-voices.lock.json',
);
const describeExternalVoiceLock = fs.existsSync(externalVoiceLockPath) ? describe : describe.skip;

describeExternalVoiceLock('readVoiceLock — external TTS contract', () => {
  const lockPath = externalVoiceLockPath;

  it('reads the real TTS lock rather than keeping a second copy', () => {
    // Two records of the same fact drift; the service that ships the audio owns
    // the voice inventory. This cross-repository contract runs whenever the TTS
    // sibling is checked out; isolated API CI skips only this describe block.
    const voices = readVoiceLock(JSON.parse(fs.readFileSync(lockPath, 'utf8')));
    expect(voices.map((v) => v.engineVoice)).toEqual([
      'en_US-ljspeech-medium',
      'en_US-norman-medium',
    ]);
    expect(voices.map((v) => v.publicVoiceId)).toEqual(['en-aria', 'en-guy']);
  });

  it('carries the model digest and licence through', () => {
    const voices = readVoiceLock(JSON.parse(fs.readFileSync(lockPath, 'utf8')));
    for (const entry of voices) {
      expect(entry.modelSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.modelLicense).toBe('MIT');
      expect(entry.trainingDataset).toBeTruthy();
    }
  });

  it('reports the rights status as pending while the service blocks release', () => {
    // The judgement belongs to the service that owns the model, not to DSD.
    const voices = readVoiceLock(JSON.parse(fs.readFileSync(lockPath, 'utf8')));
    for (const entry of voices) {
      expect(entry.trainingDatasetStatus).toBe('pending');
    }
  });

  it('reports approved only when the service says so', () => {
    const document = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    document.publicReleaseEligibility = 'approved';
    for (const entry of readVoiceLock(document)) {
      expect(entry.trainingDatasetStatus).toBe('approved');
    }
  });
});

describe('assetEligibility', () => {
  it('is reviewable only from the recorded release image', () => {
    expect(assetEligibility(RUNTIME, RUNTIME)).toBe('reviewable');
  });

  it.each([
    ['an unpinned runtime', null, RUNTIME],
    ['no recorded image', RUNTIME, null],
    ['a different image', 'sha256:' + 'b'.repeat(64), RUNTIME],
  ])('is a test candidate with %s', (_label, actual, expected) => {
    expect(assetEligibility(actual, expected)).toBe('test_candidate');
  });
});

describe('buildAsset', () => {
  it('produces an asset awaiting review from a clean release-image run', () => {
    const asset = buildAsset(input());
    expect(asset.reviewStatus).toBe('awaiting_review');
    expect(asset.qaFindings).toEqual([]);
    expect(asset.releaseRuntimeDigest).toBe(RUNTIME);
  });

  it('never sets a reviewer', () => {
    // Generation and review are separate acts; the database enforces this too.
    expect(buildAsset(input())).not.toHaveProperty('reviewedBy');
    expect(Object.keys(buildAsset(input()))).not.toContain('reviewedAt');
  });

  it('marks output from an unpinned runtime as a test candidate, never reviewable', () => {
    const asset = buildAsset(input({ runtimeDigest: null }));
    expect(asset.reviewStatus).toBe('pending_qa');
    expect(asset.releaseRuntimeDigest).toBeNull();
  });

  it('content-addresses the storage key', () => {
    const asset = buildAsset(input());
    expect(asset.storageKey).toBe(`dsd/audio/en-aria/${asset.audioSha256}.wav`);
  });

  it('is deterministic: same input and stack, same logical key', () => {
    expect(buildAsset(input()).logicalAssetKey).toBe(buildAsset(input()).logicalAssetKey);
  });

  it('gives the same bytes the same hash, so a re-run is idempotent', () => {
    const first = buildAsset(input());
    const second = buildAsset(input(), [first.audioSha256]);
    expect(second.audioSha256).toBe(first.audioSha256);
    // Same bytes is not a conflict.
    expect(second.reviewStatus).toBe('awaiting_review');
  });

  it('quarantines a different recording for the same generation', () => {
    // Overwriting would make "which bytes did we ship" unanswerable.
    const asset = buildAsset(input(), ['c'.repeat(64)]);
    expect(asset.reviewStatus).toBe('quarantined');
  });

  it('fails QA rather than proceeding when the audio is bad', () => {
    const silent = buildAsset(input({ bytes: wav(2000, 22050, 0) }));
    expect(silent.reviewStatus).toBe('qa_failed');
    expect(silent.qaFindings.map((f) => f.rule)).toContain('silent');
  });

  it('still records a row for audio that will not decode', () => {
    // A file that cannot be parsed is a finding, not a reason to lose the trail.
    const broken = buildAsset(input({ bytes: Buffer.from('not audio') }));
    expect(broken.reviewStatus).toBe('qa_failed');
    expect(broken.qaFindings.map((f) => f.rule)).toContain('not_decodable');
    expect(broken.durationMs).toBeGreaterThan(0);
    expect(broken.byteSize).toBeGreaterThan(0);
  });

  it('carries the model and dataset provenance onto the row', () => {
    const asset = buildAsset(input());
    expect(asset.modelSha256).toBe('f'.repeat(64));
    expect(asset.modelLicense).toBe('MIT');
    expect(asset.trainingDataset).toBe('LJ Speech');
    expect(asset.trainingDatasetStatus).toBe('approved');
  });

  it('changes the logical key when the runtime changes', () => {
    const a = buildAsset(input());
    const b = buildAsset(
      input({ runtimeDigest: 'sha256:' + 'd'.repeat(64), expectedRuntimeDigest: 'sha256:' + 'd'.repeat(64) }),
    );
    expect(a.logicalAssetKey).not.toBe(b.logicalAssetKey);
  });

  it('hashes the spoken text, not the IPA', () => {
    // The engine is given the headword; the IPA is a separate human record.
    const asset = buildAsset(input({ spokenText: 'rehearse' }));
    const other = buildAsset(input({ spokenText: 'rɪˈhɜːrs' }));
    expect(asset.inputTextSha256).not.toBe(other.inputTextSha256);
  });

  it('agrees with the key helper', () => {
    const asset = buildAsset(input());
    expect(asset.logicalAssetKey).toBe(
      logicalAssetKey({
        text: 'rehearse',
        publicVoiceId: 'en-aria',
        engineVoice: 'en_US-ljspeech-medium',
        engineVersion: '2023.11.14-2',
        modelRevision: '9f967d15e9ccdf43078586d1476ee70f314401bd',
        modelSha256: 'f'.repeat(64),
        runtimeDigest: RUNTIME,
        encoder: { format: 'wav', sampleRate: 22050, channels: 1 },
      }),
    );
  });
});

describe('what the generator will not do', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'audio-generate.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('never writes a review decision', () => {
    expect(code).not.toMatch(/reviewed_by|reviewed_at|'accepted'/);
  });

  it('voices only approved pronunciations', () => {
    expect(code).toMatch(/dsd_pronunciations/);
    expect(code).toMatch(/p\.status IN \('approved','published'\)/);
  });

  it('does not generate example or sentence audio', () => {
    // Runtime-only, and not part of the corpus release under this plan.
    expect(code).not.toMatch(/dsd_examples|example_en|sentence/i);
  });

  it('opens no legacy connection', () => {
    const modules = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    for (const module of modules) {
      expect(module).toMatch(/^fs$|^path$|^dotenv$|dsd-corpus|\.\/lib\//);
    }
  });
});
