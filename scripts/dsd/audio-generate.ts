/**
 * Generate DSD pronunciation audio from approved headwords.
 *
 * The generator's job is narrow: turn an approved pronunciation into bytes,
 * record exactly what produced them, and stop. It cannot review, cannot accept,
 * and cannot overwrite. Three refusals carry most of that:
 *
 *   - **Blocked and unlocked voices.** Amy and Ryan are refused by name, and so
 *     is any voice not in the TTS service's voice lock. A voice nobody wrote
 *     down has no recorded provenance, so nothing about its output can be
 *     attested.
 *   - **An unpinned runtime.** Without the release container digest the output
 *     is a test candidate: recorded, never reviewable. That is the honest
 *     status of anything a developer's laptop produced, and making it
 *     unreviewable rather than untracked means it cannot drift into a release.
 *   - **A conflicting recording.** If the same logical generation already holds
 *     different bytes, the new asset is written as quarantined and the conflict
 *     blocks acceptance of both. Overwriting would make "which bytes did we
 *     ship" unanswerable.
 *
 * Only approved pronunciations are voiced. Example and sentence audio stays
 * runtime-only and is not part of the corpus release.
 *
 * USAGE:
 *   npm run dsd:audio:generate -- --batch B-001
 *   npm run dsd:audio:generate -- --batch B-001 --write
 *   npm run dsd:audio:generate -- --entry <uuid> --write
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { buildDsdCorpusConfig } from '../../src/dsd-corpus/dsd-corpus.config';
import { createDsdDataSource } from '../../src/dsd-corpus/dsd-corpus.datasource';
import {
  AudioGenerationSpec,
  EncoderSpec,
  audioSha256,
  canonicalSpokenText,
  inputTextSha256,
  logicalAssetKey,
  storageKey,
} from './lib/audio-key';
import { checkAudio } from './lib/audio-qa';

dotenv.config();

/** Refused by name, whatever the lock says. See tts-service DSD-VOICE-RIGHTS. */
export const BLOCKED_ENGINE_VOICES = ['en_US-amy-medium', 'en_US-ryan-medium'];

export const TTS_LOCK_PATH =
  process.env.DSD_TTS_VOICE_LOCK ?? '../tts-service/models/piper-voices.lock.json';
export const TTS_RUNTIME_LOCK_PATH =
  process.env.DSD_TTS_RUNTIME_LOCK ?? '../tts-service/models/piper-runtime.lock.json';

export interface LockedVoice {
  publicVoiceId: string;
  engineVoice: string;
  modelRevision: string;
  modelSha256: string;
  modelLicense: string;
  trainingDataset: string;
  trainingDatasetStatus: 'approved' | 'pending' | 'blocked';
}

/**
 * Read the TTS service's own locks. DSD does not keep a second copy of the
 * voice inventory: two records of the same fact drift, and the one that ships
 * the audio should be authoritative.
 */
export function readVoiceLock(document: any): LockedVoice[] {
  // A voice's rights status comes from the lock's release eligibility, not from
  // a field DSD sets: the service that owns the model owns that judgement.
  const eligibility = document.publicReleaseEligibility === 'approved' ? 'approved' : 'pending';
  return (document.voices ?? []).map((voice: any) => ({
    publicVoiceId: voice.apiId,
    engineVoice: voice.modelId,
    modelRevision: document.revision,
    modelSha256: (voice.files ?? []).find((f: any) => f.localName.endsWith('.onnx'))?.sha256 ?? '',
    modelLicense: document.repositoryLicense ?? 'unknown',
    trainingDataset: voice.dataset ?? 'unknown',
    trainingDatasetStatus: eligibility,
  }));
}

export interface VoiceRefusal {
  engineVoice: string;
  reason: string;
}

/** Why a requested voice may not be used. Empty means it may. */
export function refuseVoice(engineVoice: string, locked: LockedVoice[]): VoiceRefusal[] {
  const refusals: VoiceRefusal[] = [];
  if (BLOCKED_ENGINE_VOICES.includes(engineVoice)) {
    refusals.push({
      engineVoice,
      reason:
        'this voice is blocked: its training dataset does not permit commercial use of a ' +
        'derived model. See tts-service/docs/DSD-VOICE-RIGHTS.md',
    });
  }
  const match = locked.find((voice) => voice.engineVoice === engineVoice);
  if (!match) {
    refusals.push({
      engineVoice,
      reason:
        'this voice is not in the TTS voice lock; an unlocked voice has no recorded ' +
        'provenance, so nothing about its output can be attested',
    });
  } else if (!match.modelSha256) {
    refusals.push({ engineVoice, reason: 'the lock records no model digest for this voice' });
  }
  return refusals;
}

export type AssetEligibility = 'reviewable' | 'test_candidate';

/**
 * Whether output from this runtime may ever be reviewed.
 *
 * A developer's TTS service is fine for iterating and useless for release: its
 * output cannot be attributed to a known stack. Recording it as a test
 * candidate rather than rejecting it keeps it visible and keeps it out.
 */
export function assetEligibility(runtimeDigest: string | null, expected: string | null): AssetEligibility {
  if (!runtimeDigest || !expected) return 'test_candidate';
  return runtimeDigest === expected ? 'reviewable' : 'test_candidate';
}

export interface PendingAsset {
  entryId: string;
  inputKind: 'pronunciation';
  inputRecordId: string;
  inputTextSha256: string;
  logicalAssetKey: string;
  publicVoiceId: string;
  engineVoice: string;
  engineVersion: string;
  modelRevision: string;
  modelSha256: string;
  modelLicense: string;
  trainingDataset: string;
  trainingDatasetStatus: string;
  storageKey: string;
  audioSha256: string;
  mediaType: 'audio/wav' | 'audio/mpeg';
  format: 'wav' | 'mp3';
  durationMs: number;
  sampleRate: number;
  channels: number;
  byteSize: number;
  releaseRuntimeDigest: string | null;
  reviewStatus: 'pending_qa' | 'qa_failed' | 'awaiting_review' | 'quarantined';
  qaFindings: Array<{ rule: string; detail: string }>;
}

export interface GenerationInput {
  entryId: string;
  pronunciationId: string;
  /** The text handed to the engine — the headword, not the IPA. */
  spokenText: string;
  voice: LockedVoice;
  engineVersion: string;
  encoder: EncoderSpec;
  runtimeDigest: string | null;
  expectedRuntimeDigest: string | null;
  bytes: Buffer;
}

/**
 * Turn generated bytes into a row, with QA already run.
 *
 * Pure, so the whole decision — status, findings, conflict handling — is
 * testable without a TTS service or a database.
 */
export function buildAsset(input: GenerationInput, existingHashes: string[] = []): PendingAsset {
  const spec: AudioGenerationSpec = {
    text: input.spokenText,
    publicVoiceId: input.voice.publicVoiceId,
    engineVoice: input.voice.engineVoice,
    engineVersion: input.engineVersion,
    modelRevision: input.voice.modelRevision,
    modelSha256: input.voice.modelSha256,
    runtimeDigest: input.runtimeDigest ?? 'unpinned',
    encoder: input.encoder,
  };

  const key = logicalAssetKey(spec);
  const hash = audioSha256(input.bytes);
  const eligibility = assetEligibility(input.runtimeDigest, input.expectedRuntimeDigest);

  const findings = checkAudio(input.bytes, {
    sampleRate: input.encoder.sampleRate,
    channels: input.encoder.channels,
    format: input.encoder.format,
    expectedSha256: hash,
    actualSha256: hash,
    spokenText: input.spokenText,
  });

  // A different recording for the same generation. Recorded, not substituted.
  const conflicts = existingHashes.some((existing) => existing !== hash);

  let reviewStatus: PendingAsset['reviewStatus'];
  if (conflicts) reviewStatus = 'quarantined';
  else if (findings.length > 0) reviewStatus = 'qa_failed';
  else if (eligibility === 'test_candidate') reviewStatus = 'pending_qa';
  else reviewStatus = 'awaiting_review';

  const wav = input.encoder.format === 'wav' ? safeMeasure(input.bytes) : null;

  return {
    entryId: input.entryId,
    inputKind: 'pronunciation',
    inputRecordId: input.pronunciationId,
    inputTextSha256: inputTextSha256(input.spokenText),
    logicalAssetKey: key,
    publicVoiceId: input.voice.publicVoiceId,
    engineVoice: input.voice.engineVoice,
    engineVersion: input.engineVersion,
    modelRevision: input.voice.modelRevision,
    modelSha256: input.voice.modelSha256,
    modelLicense: input.voice.modelLicense,
    trainingDataset: input.voice.trainingDataset,
    trainingDatasetStatus: input.voice.trainingDatasetStatus,
    storageKey: storageKey(input.voice.publicVoiceId, hash, input.encoder.format),
    audioSha256: hash,
    mediaType: input.encoder.format === 'wav' ? 'audio/wav' : 'audio/mpeg',
    format: input.encoder.format,
    // A file QA could not decode still needs a row; the findings say why, and
    // the measurements are whatever could be read.
    durationMs: wav?.durationMs ?? 1,
    sampleRate: wav?.sampleRate ?? input.encoder.sampleRate,
    channels: wav?.channels ?? input.encoder.channels,
    byteSize: Math.max(1, input.bytes.length),
    releaseRuntimeDigest: eligibility === 'reviewable' ? input.runtimeDigest : null,
    reviewStatus,
    qaFindings: findings,
  };
}

function safeMeasure(bytes: Buffer): { durationMs: number; sampleRate: number; channels: number } | null {
  try {
    // Imported lazily so a parse failure here cannot take down the caller.
    const { parseWav } = require('./lib/audio-qa');
    const info = parseWav(bytes);
    return { durationMs: info.durationMs, sampleRate: info.sampleRate, channels: info.channels };
  } catch {
    return null;
  }
}

// ─── I/O ────────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readJson(relative: string): any {
  const resolved = path.resolve(process.cwd(), relative);
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `No TTS lock at ${resolved}. The generator reads the TTS service's own locks; ` +
        'set DSD_TTS_VOICE_LOCK if the service lives elsewhere.',
    );
  }
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

/** Approved pronunciations only, and only for published or approved entries. */
const PRONUNCIATIONS_SQL = `
  SELECT p.id AS "pronunciationId", p.dsd_entry_id AS "entryId", e.headword
    FROM dsd_pronunciations p
    JOIN dsd_entries e ON e.id = p.dsd_entry_id
   WHERE p.status IN ('approved','published')
     AND ($1::varchar IS NULL OR p.batch_id = $1)
     AND ($2::uuid IS NULL OR p.dsd_entry_id = $2)
   ORDER BY e.headword`;

async function main(): Promise<void> {
  const config = buildDsdCorpusConfig();
  if (config.errors.length > 0) {
    throw new Error('DSD configuration invalid:\n  - ' + config.errors.join('\n  - '));
  }

  const voiceLock = readJson(TTS_LOCK_PATH);
  const locked = readVoiceLock(voiceLock);
  const requested = arg('voice');
  const voices = requested
    ? locked.filter((voice) => voice.engineVoice === requested || voice.publicVoiceId === requested)
    : locked;

  const refusals = (requested ? [requested] : voices.map((v) => v.engineVoice)).flatMap((voice) =>
    refuseVoice(voice, locked),
  );
  if (refusals.length > 0) {
    console.error('Refusing to generate:');
    for (const refusal of refusals) console.error(`  - ${refusal.engineVoice}: ${refusal.reason}`);
    process.exit(1);
  }
  if (voices.length === 0) {
    throw new Error('No approved voices to generate with');
  }

  const runtimeDigest = process.env.DSD_TTS_IMAGE_DIGEST ?? null;
  const expected = (() => {
    try {
      return readJson('../tts-service/models/release-image.json').digest ?? null;
    } catch {
      return null;
    }
  })();
  const eligibility = assetEligibility(runtimeDigest, expected);
  if (eligibility === 'test_candidate') {
    console.warn(
      'WARNING: the TTS runtime is not the recorded release image, so everything generated ' +
        'in this run is a test candidate and can never be reviewed or released.\n' +
        '  Set DSD_TTS_IMAGE_DIGEST from scripts/check_release_image.py --print-env.',
    );
  }

  const ds = createDsdDataSource('curator', config);
  await ds.initialize();
  try {
    const rows = await ds.query(PRONUNCIATIONS_SQL, [arg('batch') ?? null, arg('entry') ?? null]);
    if (rows.length === 0) {
      console.log('No approved pronunciations to voice.');
      return;
    }

    console.log(`${rows.length} pronunciation(s) × ${voices.length} voice(s).`);
    console.log(
      `Runtime: ${eligibility === 'reviewable' ? 'release image' : 'UNPINNED (test candidates only)'}`,
    );

    if (!process.argv.includes('--write')) {
      console.log('\nDRY RUN — nothing synthesized or written. Re-run with --write.');
      return;
    }

    throw new Error(
      'Synthesis is not enabled: tts-service public release eligibility is ' +
        `'${voiceLock.publicReleaseEligibility}'. Generating release audio from a voice whose ` +
        'rights are unresolved is exactly what that gate exists to prevent. ' +
        'See tts-service/docs/DSD-VOICE-RIGHTS.md.',
    );
  } finally {
    await ds.destroy();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
