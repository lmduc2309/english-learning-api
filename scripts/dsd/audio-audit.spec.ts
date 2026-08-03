import * as fs from 'fs';
import * as path from 'path';
import { AuditRow, BLOCKED_ENGINE_VOICES, auditAssets } from './audio-audit';

const HASH_A = 'a'.repeat(64);
const KEY = 'k'.repeat(64);

function row(overrides: Partial<AuditRow> = {}): AuditRow {
  const hash = overrides.audioSha256 ?? HASH_A;
  const voice = overrides.publicVoiceId ?? 'en-aria';
  return {
    assetId: 'asset-1',
    headword: 'rehearse',
    engineVoice: 'en_US-ljspeech-medium',
    publicVoiceId: voice,
    storageKey: `dsd/audio/${voice}/${hash}.wav`,
    audioSha256: hash,
    inputTextSha256: '1'.repeat(64),
    logicalAssetKey: KEY,
    format: 'wav',
    reviewStatus: 'accepted',
    trainingDatasetStatus: 'approved',
    qaFindings: [],
    reviewedBy: 'DSD-R-001',
    generatorActor: 'DSD-G-001',
    releaseRuntimeDigest: 'sha256:' + 'r'.repeat(64),
    ...overrides,
  };
}

const rules = (report: { findings: { rule: string }[] }) => report.findings.map((f) => f.rule);

describe('a fully cleared asset is servable', () => {
  it('needs QA, rights, a reviewer and the release runtime, all four', () => {
    const report = auditAssets([row()]);
    expect(report.findings).toEqual([]);
    expect(report.servable).toBe(1);
  });

  it('counts statuses', () => {
    const report = auditAssets([row(), row({ assetId: 'a2', reviewStatus: 'rejected', logicalAssetKey: 'j'.repeat(64) })]);
    expect(report.byStatus).toMatchObject({ accepted: 1, rejected: 1 });
  });
});

describe('an accepted asset that should not be', () => {
  it.each([
    ['carries QA findings', { qaFindings: [{ rule: 'clipping', detail: 'x' }] }, 'accepted_with_qa_findings'],
    ['names no reviewer', { reviewedBy: null }, 'accepted_without_reviewer'],
    ['was reviewed by its generator', { reviewedBy: 'DSD-G-001' }, 'self_reviewed'],
    ['has unresolved rights', { trainingDatasetStatus: 'pending' }, 'accepted_without_rights'],
    ['came from an unpinned runtime', { releaseRuntimeDigest: null }, 'accepted_test_candidate'],
  ])('is reported when it %s', (_label, overrides, rule) => {
    // Each of these should be impossible. If one exists, the constraint meant
    // to prevent it is not working, and the audit must not round it down.
    const report = auditAssets([row(overrides as Partial<AuditRow>)]);
    expect(rules(report)).toContain(rule);
    expect(report.servable).toBe(0);
  });
});

describe('storage keys must agree with the row', () => {
  it('flags a key naming different bytes', () => {
    // The object being served is not the object that was measured.
    const report = auditAssets([row({ storageKey: `dsd/audio/en-aria/${'b'.repeat(64)}.wav` })]);
    expect(rules(report)).toContain('storage_key_mismatch');
  });

  it('flags a key under the wrong voice', () => {
    expect(rules(auditAssets([row({ storageKey: `dsd/audio/en-guy/${HASH_A}.wav` })]))).toContain(
      'storage_key_voice_mismatch',
    );
  });

  it('flags a key with the wrong extension', () => {
    expect(rules(auditAssets([row({ storageKey: `dsd/audio/en-aria/${HASH_A}.mp3` })]))).toContain(
      'storage_key_format_mismatch',
    );
  });

  it('flags a malformed key', () => {
    expect(rules(auditAssets([row({ storageKey: 'uploads/audio/rehearse.wav' })]))).toContain(
      'malformed_storage_key',
    );
  });
});

describe('blocked voices', () => {
  it.each(BLOCKED_ENGINE_VOICES)('flags an asset generated with %s', (blocked) => {
    expect(rules(auditAssets([row({ engineVoice: blocked })]))).toContain('blocked_voice');
  });
});

describe('conflicts', () => {
  it('flags a live asset sharing a logical key with a quarantined one', () => {
    const report = auditAssets([
      row(),
      row({ assetId: 'a2', reviewStatus: 'quarantined', audioSha256: 'c'.repeat(64) }),
    ]);
    expect(rules(report)).toContain('unresolved_conflict');
  });

  it('flags two live assets at the same logical key', () => {
    // The partial unique index should prevent this; if it exists, say so.
    const report = auditAssets([row(), row({ assetId: 'a2', audioSha256: 'c'.repeat(64) })]);
    expect(rules(report)).toContain('duplicate_live_asset');
  });

  it('flags one recording serving two different inputs', () => {
    const report = auditAssets([
      row(),
      row({ assetId: 'a2', inputTextSha256: '2'.repeat(64), logicalAssetKey: 'j'.repeat(64) }),
    ]);
    expect(rules(report)).toContain('duplicate_audio');
  });
});

describe('a reviewer recorded without a decision', () => {
  it('is reported', () => {
    // A pre-filled listening queue would look like this.
    const report = auditAssets([row({ reviewStatus: 'awaiting_review', reviewedBy: 'DSD-R-001' })]);
    expect(rules(report)).toContain('reviewer_without_decision');
  });
});

describe('nothing else counts as servable', () => {
  it.each(['pending_qa', 'qa_failed', 'awaiting_review', 'rejected', 'quarantined'])(
    '%s is not servable',
    (status) => {
      expect(auditAssets([row({ reviewStatus: status })]).servable).toBe(0);
    },
  );
});

describe('the audit is read-only', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'audio-audit.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('connects as the auditor', () => {
    expect(code).toMatch(/createDsdDataSource\('audit'/);
  });

  it('issues no mutating statement', () => {
    expect(code).not.toMatch(/INSERT INTO|UPDATE\s+dsd_|DELETE FROM/);
  });

  it('exits non-zero when it finds something', () => {
    expect(code).toMatch(/process\.exit\(1\)/);
  });
});
