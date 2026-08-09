import { RegistrySnapshot } from './lib/registry';
import {
  AudioAssetRow,
  AudioDecisionsFile,
  FORBIDDEN_AUDIO_DECISION_FIELDS,
  QueueAsset,
  buildAudioQueue,
  planAudioReview,
  validateAudioDecisions,
} from './audio-review';

const ASSET = '11111111-1111-1111-1111-111111111111';
const ASSET_B = '22222222-2222-2222-2222-222222222222';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const VOICE = 'en_US-ljspeech-medium';
const VOICE_RIGHTS = { [VOICE]: 'EV-AUDIO-LJSPEECH-RIGHTS-001' };

function registry(overrides: Partial<RegistrySnapshot> = {}): RegistrySnapshot {
  return {
    approvedScopesBySource: {},
    contributors: {
      'DSD-R-001': { status: 'active', roles: ['audio_reviewer'], rightsEvidenceId: 'EV-IP-010' },
      'DSD-A-001': { status: 'active', roles: ['author'], rightsEvidenceId: 'EV-IP-001' },
      'DSD-G-001': { status: 'active', roles: ['audio_reviewer'], rightsEvidenceId: 'EV-IP-020' },
    },
    ...overrides,
  };
}

function file(overrides: Partial<AudioDecisionsFile> = {}): AudioDecisionsFile {
  return {
    decisions_version: 1,
    queue_id: 'QA-B-001-20260803',
    batch_id: 'B-001',
    reviewer_id: 'DSD-R-001',
    decisions: [
      {
        asset_id: ASSET,
        audio_sha256: HASH_A,
        listened: true,
        decision: 'accept',
        notes: 'Stress on the second syllable, clean onset.',
      },
    ],
    ...overrides,
  };
}

function row(overrides: Partial<AudioAssetRow> = {}): AudioAssetRow {
  return {
    assetId: ASSET,
    audioSha256: HASH_A,
    reviewStatus: 'awaiting_review',
    generatorActor: 'DSD-G-001',
    engineVoice: VOICE,
    trainingDatasetStatus: 'approved',
    qaFindings: [],
    hasQuarantinedConflict: false,
    ...overrides,
  };
}

function plan(doc: AudioDecisionsFile, rows: AudioAssetRow[]) {
  return planAudioReview(doc, rows, VOICE_RIGHTS);
}

function queueAsset(overrides: Partial<QueueAsset> = {}): QueueAsset {
  return {
    assetId: ASSET,
    headword: 'rehearse',
    publicVoiceId: 'en-aria',
    storageKey: `dsd/audio/en-aria/${HASH_A}.wav`,
    audioSha256: HASH_A,
    durationMs: 900,
    reviewStatus: 'awaiting_review',
    generatorActor: 'DSD-G-001',
    qaFindings: [],
    ...overrides,
  };
}

describe('buildAudioQueue', () => {
  it('gives the reviewer what they need to play the clip', () => {
    const item = buildAudioQueue('B-001', '2026-08-03T09:00:00.000Z', [queueAsset()]).items[0];
    expect(item.storage_key).toContain(HASH_A);
    expect(item.audio_sha256).toBe(HASH_A);
    expect(item.duration_ms).toBe(900);
  });

  it('names the neutral voice, never the model', () => {
    const item = buildAudioQueue('B-001', '2026-08-03T09:00:00.000Z', [queueAsset()]).items[0];
    expect(item.voice).toBe('en-aria');
    expect(JSON.stringify(item)).not.toMatch(/ljspeech|norman|amy|ryan/i);
  });

  it('omits assets that failed QA', () => {
    // A known defect should not consume a reviewer's attention.
    const failed = queueAsset({ qaFindings: [{ rule: 'silent', detail: 'RMS 0' }] });
    expect(buildAudioQueue('B-001', '2026-08-03T09:00:00.000Z', [failed]).items).toEqual([]);
  });

  it('omits test candidates, which are not reviewable at all', () => {
    const candidate = queueAsset({ reviewStatus: 'pending_qa' });
    expect(buildAudioQueue('B-001', '2026-08-03T09:00:00.000Z', [candidate]).items).toEqual([]);
  });

  it('is deterministic', () => {
    expect(buildAudioQueue('B-001', '2026-08-03T09:00:00.000Z', [queueAsset()])).toEqual(
      buildAudioQueue('B-001', '2026-08-03T09:00:00.000Z', [queueAsset()]),
    );
  });
});

describe('validateAudioDecisions', () => {
  it('accepts a well-formed file', () => {
    expect(validateAudioDecisions(file(), registry())).toEqual([]);
  });

  it('requires an explicit acknowledgement that the clip was played', () => {
    const bad = file();
    bad.decisions[0].listened = false;
    expect(validateAudioDecisions(bad, registry()).join(' ')).toMatch(/somebody played the clip/);
  });

  it('requires the hash of the bytes that were played', () => {
    // Without it there is nothing tying the verdict to what was heard.
    const bad = file();
    bad.decisions[0].audio_sha256 = '';
    expect(validateAudioDecisions(bad, registry()).join(' ')).toMatch(/bytes that were played/);
  });

  it('requires notes on a rejection', () => {
    const bad = file();
    bad.decisions[0].decision = 'reject';
    bad.decisions[0].notes = '';
    expect(validateAudioDecisions(bad, registry()).join(' ')).toMatch(/what was wrong/);
  });

  it('rejects a reviewer who only holds an author role', () => {
    expect(validateAudioDecisions(file({ reviewer_id: 'DSD-A-001' }), registry()).join(' ')).toMatch(
      /does not hold a listening-review role/,
    );
  });

  it('rejects an unknown or inactive reviewer', () => {
    expect(validateAudioDecisions(file({ reviewer_id: 'DSD-R-999' }), registry()).join(' ')).toMatch(
      /not in the contributor registry/,
    );
    const reg = registry();
    reg.contributors['DSD-R-001'].status = 'revoked';
    expect(validateAudioDecisions(file(), reg).join(' ')).toMatch(/not active/);
  });

  it('rejects two decisions for the same asset', () => {
    const bad = file();
    bad.decisions.push({ ...bad.decisions[0], decision: 'reject', notes: 'actually no' });
    expect(validateAudioDecisions(bad, registry()).join(' ')).toMatch(/already has a decision/);
  });

  it.each(FORBIDDEN_AUDIO_DECISION_FIELDS)('rejects the field %s', (field) => {
    const bad: any = file();
    bad.decisions[0][field] = 'x';
    expect(validateAudioDecisions(bad, registry()).join(' ')).toMatch(
      new RegExp(`forbidden field '${field}'`),
    );
  });

  it('rejects a file where every note is identical', () => {
    // One verdict typed once and copied is exactly what per-asset review forbids.
    const bad = file({
      decisions: ['a', 'b', 'c', 'd'].map((suffix, index) => ({
        asset_id: `${index + 1}1111111-1111-1111-1111-11111111111${suffix.length}`.replace(
          /[^0-9a-f-]/g,
          '1',
        ),
        audio_sha256: HASH_A,
        listened: true,
        decision: 'accept' as const,
        notes: 'Sounds fine.',
      })),
    });
    expect(validateAudioDecisions(bad, registry()).join(' ')).toMatch(/one batch verdict/);
  });

  it('allows distinct notes across many assets', () => {
    const good = file({
      decisions: [1, 2, 3, 4].map((n) => ({
        asset_id: `${n}1111111-1111-1111-1111-111111111111`,
        audio_sha256: HASH_A,
        listened: true,
        decision: 'accept' as const,
        notes: `Clean, checked syllable ${n}.`,
      })),
    });
    expect(validateAudioDecisions(good, registry())).toEqual([]);
  });
});

describe('planAudioReview', () => {
  it('applies a decision to an asset awaiting review', () => {
    const result = plan(file(), [row()]);
    expect(result.blocked).toEqual([]);
    expect(result.toApply[0]).toMatchObject({
      assetId: ASSET,
      status: 'accepted',
      voiceRightsEvidenceId: VOICE_RIGHTS[VOICE],
    });
  });

  it('refuses a decision about bytes that are no longer the asset', () => {
    // Regenerated after the queue was built: the reviewer heard something else.
    const result = plan(file(), [row({ audioSha256: HASH_B })]);
    expect(result.toApply).toEqual([]);
    expect(result.blocked.join(' ')).toMatch(/stale/);
  });

  it('refuses self-review by the generator', () => {
    const result = plan(file(), [row({ generatorActor: 'DSD-R-001' })]);
    expect(result.blocked.join(' ')).toMatch(/generated it and cannot review it/);
  });

  it('refuses an asset that already has a decision', () => {
    expect(plan(file(), [row({ reviewStatus: 'accepted' })]).blocked.join(' ')).toMatch(
      /not awaiting review/,
    );
  });

  it('refuses an asset with unresolved QA findings', () => {
    const result = plan(file(), [
      row({ qaFindings: [{ rule: 'clipping', detail: '80 samples' }] }),
    ]);
    expect(result.blocked.join(' ')).toMatch(/unresolved QA findings \(clipping\)/);
  });

  it('refuses an asset with a quarantined conflict', () => {
    expect(
      plan(file(), [row({ hasQuarantinedConflict: true })]).blocked.join(' '),
    ).toMatch(/quarantined conflict/);
  });

  it('refuses acceptance while voice rights are unresolved', () => {
    // The honest state today: the TTS service blocks release eligibility.
    const result = plan(file(), [row({ trainingDatasetStatus: 'pending' })]);
    expect(result.toApply).toEqual([]);
    expect(result.blocked.join(' ')).toMatch(/voice rights are 'pending'/);
  });

  it('still allows a rejection while voice rights are unresolved', () => {
    // Rights block shipping, not the judgement that a clip is bad.
    const doc = file();
    doc.decisions[0].decision = 'reject';
    doc.decisions[0].notes = 'Wrong stress placement.';
    const result = plan(doc, [row({ trainingDatasetStatus: 'pending' })]);
    expect(result.blocked).toEqual([]);
    expect(result.toApply[0].status).toBe('rejected');
    expect(result.toApply[0].voiceRightsEvidenceId).toBeNull();
  });

  it('refuses an asset that does not exist', () => {
    expect(plan(file(), []).blocked.join(' ')).toMatch(/no such audio asset/);
  });

  it('reports every blocked decision rather than the first', () => {
    const doc = file({
      decisions: [
        { asset_id: ASSET, audio_sha256: HASH_A, listened: true, decision: 'accept', notes: 'a' },
        { asset_id: ASSET_B, audio_sha256: HASH_A, listened: true, decision: 'accept', notes: 'b' },
      ],
    });
    const result = plan(doc, [
      row({ reviewStatus: 'accepted' }),
      row({ assetId: ASSET_B, generatorActor: 'DSD-R-001' }),
    ]);
    expect(result.blocked).toHaveLength(2);
  });

  it('refuses acceptance when the source registry has no approved voice-rights evidence', () => {
    const result = planAudioReview(file(), [row()], {});
    expect(result.toApply).toEqual([]);
    expect(result.blocked.join(' ')).toMatch(/no approved model\/training-data rights evidence/);
  });
});
