/**
 * Integration checks against a real S3-compatible store.
 *
 * Skipped unless DSD_AUDIO_S3_ENDPOINT and DSD_AUDIO_S3_BUCKET are set, so the
 * suite stays runnable with no infrastructure. Run against MinIO with:
 *
 *   docker run -d --name dsd-minio -p 9100:9000 \
 *     -e MINIO_ROOT_USER=dsdadmin -e MINIO_ROOT_PASSWORD=dsdadmin-secret \
 *     minio/minio server /data
 *   AWS_ACCESS_KEY_ID=dsdadmin AWS_SECRET_ACCESS_KEY=dsdadmin-secret \
 *   AWS_DEFAULT_REGION=us-east-1 DSD_AUDIO_S3_ENDPOINT=http://localhost:9100 \
 *   DSD_AUDIO_S3_BUCKET=dsd-audio-test \
 *     npx jest --config jest.scripts.config.js audio-storage-live
 *
 * These cover the acceptance criteria that cannot be shown with fakes: that
 * corrupting an object is actually detected, that versioning makes the original
 * recoverable, and that a content-addressed key is never silently overwritten.
 */
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import { AwsCliObjectStore } from './lib/object-store';
import { auditStorage, storageGate } from './audio-storage-audit';

const ENDPOINT = process.env.DSD_AUDIO_S3_ENDPOINT;
const BUCKET = process.env.DSD_AUDIO_S3_BUCKET;
const REGION = process.env.AWS_DEFAULT_REGION ?? 'us-east-1';

const describeLive = ENDPOINT && BUCKET ? describe : describe.skip;

function aws(args: string[]): string {
  return execFileSync('aws', ['--region', REGION, '--endpoint-url', ENDPOINT!, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** A small but real WAV, so the bytes being hashed are audio bytes. */
function wav(seed: number): Buffer {
  const sampleRate = 22050;
  const frames = sampleRate;
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    data.writeInt16LE(Math.round(Math.sin((i / sampleRate) * 2 * Math.PI * (200 + seed)) * 12000), i * 2);
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

const sha = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');

describeLive('audio storage against a live object store', () => {
  const store = new AwsCliObjectStore({
    bucket: BUCKET!,
    prefix: 'dsd/audio',
    region: REGION,
    endpoint: ENDPOINT,
  });

  const bytes = wav(1);
  const hash = sha(bytes);
  const key = `dsd/audio/en-aria/${hash}.wav`;

  const asset = {
    assetId: 'asset-live',
    storageKey: key,
    audioSha256: hash,
    byteSize: bytes.length,
    reviewStatus: 'accepted',
    publicVoiceId: 'en-aria',
    engineVoice: 'en_US-ljspeech-medium',
  };

  beforeAll(() => {
    try {
      aws(['s3api', 'create-bucket', '--bucket', BUCKET!]);
    } catch {
      /* already exists */
    }
    aws([
      's3api', 'put-bucket-versioning', '--bucket', BUCKET!,
      '--versioning-configuration', 'Status=Enabled',
    ]);
    // Clear the prefix so a rerun starts from a known state.
    try {
      const listed = JSON.parse(
        aws(['s3api', 'list-object-versions', '--bucket', BUCKET!, '--prefix', 'dsd/audio/', '--output', 'json']),
      );
      for (const entry of [...(listed.Versions ?? []), ...(listed.DeleteMarkers ?? [])]) {
        aws(['s3api', 'delete-object', '--bucket', BUCKET!, '--key', entry.Key, '--version-id', entry.VersionId]);
      }
    } catch {
      /* nothing to clear */
    }
  }, 120_000);

  it('creates an object and finds it intact', async () => {
    expect(await store.putIfAbsent(key, bytes)).toBe('created');

    const objects = await store.list('dsd/audio/');
    expect(objects.map((o) => o.key)).toContain(key);

    const downloaded = await store.get(key);
    expect(sha(downloaded!)).toBe(hash);
  }, 120_000);

  it('reports nothing when the store and the row agree', async () => {
    const objects = await store.list('dsd/audio/');
    const findings = auditStorage({
      assets: [asset],
      objects,
      // Encryption is asserted separately; plain MinIO has no KMS, so this
      // isolates the reconciliation rules from the bucket-config rules.
      bucket: { versioning: true, encryption: true, publicListing: false },
      verifiedHashes: { [key]: sha((await store.get(key))!) },
    });
    expect(findings).toEqual([]);
    expect(storageGate(findings).pass).toBe(true);
  }, 120_000);

  it('refuses to overwrite an existing key with different bytes', async () => {
    // The key is a content hash, so different bytes at the same key means the
    // key is lying. Reported as a conflict, never written.
    expect(await store.putIfAbsent(key, wav(2))).toBe('conflict');
  }, 120_000);

  it('treats an identical re-upload as already present', async () => {
    expect(await store.putIfAbsent(key, bytes)).toBe('exists');
  }, 120_000);

  it('detects corruption by re-hashing, and the release gate fails', async () => {
    const corrupted = Buffer.from(bytes);
    corrupted[1000] ^= 0xff; // same length, one byte different
    const fs = require('fs');
    const temp = `/tmp/dsd-live-corrupt-${process.pid}.wav`;
    fs.writeFileSync(temp, corrupted);
    aws(['s3api', 'put-object', '--bucket', BUCKET!, '--key', key, '--body', temp]);
    fs.unlinkSync(temp);

    const objects = await store.list('dsd/audio/');
    const actual = sha((await store.get(key))!);
    expect(actual).not.toBe(hash);

    const findings = auditStorage({
      assets: [asset],
      objects,
      bucket: { versioning: true, encryption: true, publicListing: false },
      verifiedHashes: { [key]: actual },
    });
    expect(findings.map((f) => f.rule)).toContain('byte_hash_mismatch');
    // An overwrite of a content-addressed key is itself a finding.
    expect(findings.map((f) => f.rule)).toContain('version_drift');
    expect(storageGate(findings).pass).toBe(false);
  }, 120_000);

  it('kept the original version, so the object is recoverable', async () => {
    const listed = JSON.parse(
      aws(['s3api', 'list-object-versions', '--bucket', BUCKET!, '--prefix', key, '--output', 'json']),
    );
    expect((listed.Versions ?? []).length).toBeGreaterThan(1);

    // Restore the non-current version and confirm the hash comes back.
    const original = (listed.Versions as any[]).find((v) => !v.IsLatest);
    const temp = `/tmp/dsd-live-restore-${process.pid}.wav`;
    aws(['s3api', 'get-object', '--bucket', BUCKET!, '--key', key, '--version-id', original.VersionId, temp]);
    const fs = require('fs');
    expect(sha(fs.readFileSync(temp))).toBe(hash);
    fs.unlinkSync(temp);
  }, 120_000);

  it('detects a deleted object', async () => {
    aws(['s3api', 'delete-object', '--bucket', BUCKET!, '--key', key]);
    const objects = await store.list('dsd/audio/');
    const findings = auditStorage({
      assets: [asset],
      objects,
      bucket: { versioning: true, encryption: true, publicListing: false },
    });
    expect(findings.map((f) => f.rule)).toContain('missing_object');
    expect(storageGate(findings).pass).toBe(false);
  }, 120_000);

  it('reports the bucket configuration it actually finds', async () => {
    const config = await store.config();
    expect(config.versioning).toBe(true);
    // Anonymous listing must never be possible.
    expect(config.publicListing).toBe(false);
  }, 120_000);
});
