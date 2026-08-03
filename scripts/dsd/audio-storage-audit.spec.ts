import * as fs from 'fs';
import * as path from 'path';
import { StoredObject, parseS3Uri } from './lib/object-store';
import {
  BLOCKED_ENGINE_VOICES,
  DbAsset,
  StorageAuditInput,
  auditStorage,
  criticalFindings,
  readStorageEnvironment,
  storageGate,
} from './audio-storage-audit';

const HASH = 'a'.repeat(64);
const KEY = `dsd/audio/en-aria/${HASH}.wav`;

function asset(overrides: Partial<DbAsset> = {}): DbAsset {
  return {
    assetId: 'asset-1',
    storageKey: KEY,
    audioSha256: HASH,
    byteSize: 1000,
    reviewStatus: 'accepted',
    publicVoiceId: 'en-aria',
    engineVoice: 'en_US-ljspeech-medium',
    ...overrides,
  };
}

function object(overrides: Partial<StoredObject> = {}): StoredObject {
  return { key: KEY, size: 1000, etag: 'abc', versionCount: 0, ...overrides };
}

function input(overrides: Partial<StorageAuditInput> = {}): StorageAuditInput {
  return {
    assets: [asset()],
    objects: [object()],
    bucket: { versioning: true, encryption: true, publicListing: false },
    ...overrides,
  };
}

const rules = (findings: { rule: string }[]) => findings.map((f) => f.rule);

describe('a consistent store and database', () => {
  it('produces no findings and passes the gate', () => {
    expect(auditStorage(input())).toEqual([]);
    expect(storageGate([])).toMatchObject({ pass: true });
  });
});

describe('bucket configuration', () => {
  it('requires versioning, because an overwrite is otherwise unrecoverable', () => {
    const findings = auditStorage(
      input({ bucket: { versioning: false, encryption: true, publicListing: false } }),
    );
    expect(rules(findings)).toContain('versioning_disabled');
  });

  it('requires default encryption', () => {
    expect(
      rules(auditStorage(input({ bucket: { versioning: true, encryption: false, publicListing: false } }))),
    ).toContain('encryption_disabled');
  });

  it('refuses anonymous listing', () => {
    // Listing exposes every hash, including unreviewed and rejected audio.
    expect(
      rules(auditStorage(input({ bucket: { versioning: true, encryption: true, publicListing: true } }))),
    ).toContain('public_listing_enabled');
  });
});

describe('database rows without correct bytes', () => {
  it('reports a missing object as critical once the asset is reviewable', () => {
    const findings = auditStorage(input({ objects: [] }));
    expect(rules(findings)).toContain('missing_object');
    expect(criticalFindings(findings)).toHaveLength(1);
  });

  it('reports a missing object as a warning while the asset is still pending', () => {
    const findings = auditStorage(
      input({ assets: [asset({ reviewStatus: 'pending_qa' })], objects: [] }),
    );
    expect(criticalFindings(findings)).toEqual([]);
    expect(rules(findings)).toContain('missing_object');
  });

  it('reports a size disagreement between metadata and bytes', () => {
    expect(rules(auditStorage(input({ objects: [object({ size: 999 })] })))).toContain(
      'size_mismatch',
    );
  });

  it('reports a key whose hash disagrees with the row', () => {
    const bad = asset({ audioSha256: 'b'.repeat(64) });
    expect(rules(auditStorage(input({ assets: [bad], objects: [object()] })))).toContain(
      'key_hash_mismatch',
    );
  });

  it('reports a malformed key', () => {
    const bad = asset({ storageKey: 'uploads/rehearse.wav' });
    expect(
      rules(auditStorage(input({ assets: [bad], objects: [object({ key: 'uploads/rehearse.wav' })] }))),
    ).toContain('malformed_key');
  });

  it('reports version drift, since a content-addressed key must never be rewritten', () => {
    expect(rules(auditStorage(input({ objects: [object({ versionCount: 1 })] })))).toContain(
      'version_drift',
    );
  });

  it('reports corruption when the downloaded bytes hash differently', () => {
    // The only check that does not trust the store.
    const findings = auditStorage(input({ verifiedHashes: { [KEY]: 'c'.repeat(64) } }));
    expect(rules(findings)).toContain('byte_hash_mismatch');
  });

  it('passes when the downloaded bytes hash as expected', () => {
    expect(auditStorage(input({ verifiedHashes: { [KEY]: HASH } }))).toEqual([]);
  });

  it.each(BLOCKED_ENGINE_VOICES)('reports an asset generated with %s', (blocked) => {
    expect(
      rules(auditStorage(input({ assets: [asset({ engineVoice: blocked })] }))),
    ).toContain('blocked_voice_asset');
  });
});

describe('objects no row claims', () => {
  it('reports an orphan as a warning, not a deletion', () => {
    // It might be the only surviving copy of something.
    const orphanKey = `dsd/audio/en-guy/${'d'.repeat(64)}.wav`;
    const findings = auditStorage(input({ objects: [object(), object({ key: orphanKey })] }));
    expect(rules(findings)).toContain('orphan_object');
    expect(criticalFindings(findings)).toEqual([]);
  });

  it('reports an object under a blocked voice prefix as critical', () => {
    const key = `dsd/audio/en-amy/${'d'.repeat(64)}.wav`;
    const findings = auditStorage(input({ objects: [object(), object({ key })] }));
    expect(rules(findings)).toContain('blocked_voice_prefix');
    expect(findings.find((f) => f.rule === 'blocked_voice_prefix')!.detail).toMatch(
      /do not delete it/,
    );
  });

  it('reports an object that is not a DSD audio key at all', () => {
    const findings = auditStorage(input({ objects: [object(), object({ key: 'random/file.txt' })] }));
    expect(rules(findings)).toContain('unexpected_object');
  });
});

describe('storageGate', () => {
  it('fails on any critical finding and names the rules', () => {
    const gate = storageGate(auditStorage(input({ objects: [] })));
    expect(gate.pass).toBe(false);
    expect(gate.detail).toContain('missing_object');
  });

  it('passes with warnings, and says how many', () => {
    const orphanKey = `dsd/audio/en-guy/${'d'.repeat(64)}.wav`;
    const gate = storageGate(auditStorage(input({ objects: [object(), object({ key: orphanKey })] })));
    expect(gate.pass).toBe(true);
    expect(gate.detail).toMatch(/warning/);
  });
});

describe('readStorageEnvironment', () => {
  const valid = {
    DSD_AUDIO_S3_URI: 's3://dsd-audio/dsd/audio',
    DSD_AUDIO_S3_REGION: 'ap-southeast-1',
    DSD_AUDIO_KMS_KEY_ID: 'arn:aws:kms:ap-southeast-1:1234:key/abc',
    DSD_AUDIO_PUBLIC_BASE_URL: 'https://cdn.dsdtech.site/audio',
  };

  it('accepts a complete configuration', () => {
    expect(readStorageEnvironment(valid).errors).toEqual([]);
  });

  it.each([
    ['DSD_AUDIO_S3_URI', 'must look like s3://'],
    ['DSD_AUDIO_S3_REGION', 'is required'],
    ['DSD_AUDIO_KMS_KEY_ID', 'encrypted at rest'],
    ['DSD_AUDIO_PUBLIC_BASE_URL', 'never by listing'],
  ])('requires %s', (key, message) => {
    const errors = readStorageEnvironment({ ...valid, [key]: '' }).errors;
    expect(errors.join(' ')).toMatch(message);
  });

  it('requires the public base URL to be https', () => {
    expect(
      readStorageEnvironment({ ...valid, DSD_AUDIO_PUBLIC_BASE_URL: 'http://cdn' }).errors.join(' '),
    ).toMatch(/must be https/);
  });
});

describe('parseS3Uri', () => {
  it('splits bucket and prefix', () => {
    expect(parseS3Uri('s3://dsd-audio/dsd/audio')).toEqual({
      bucket: 'dsd-audio',
      prefix: 'dsd/audio',
    });
  });

  it('tolerates a trailing slash and a bare bucket', () => {
    expect(parseS3Uri('s3://dsd-audio/dsd/audio/')!.prefix).toBe('dsd/audio');
    expect(parseS3Uri('s3://dsd-audio')!.prefix).toBe('');
  });

  it.each(['dsd-audio', 'https://dsd-audio', 's3://', 's3://A_B'])('rejects %s', (uri) => {
    expect(parseS3Uri(uri)).toBeNull();
  });
});

describe('the audit never deletes', () => {
  const code = fs
    .readFileSync(path.resolve(__dirname, 'audio-storage-audit.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('calls no delete operation', () => {
    // An audit that can delete is an audit that can cause the incident it was
    // written to find.
    expect(code).not.toMatch(/delete-object|deleteObject|rm\b|remove-bucket/);
  });

  it('reads the database as the auditor', () => {
    expect(code).toMatch(/createDsdDataSource\('audit'/);
  });

  it('writes nothing to the database', () => {
    expect(code).not.toMatch(/INSERT INTO|UPDATE\s+dsd_|DELETE FROM/);
  });
});
