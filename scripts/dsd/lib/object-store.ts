/**
 * A very small S3-compatible object store adapter.
 *
 * Shells out to the `aws` CLI rather than adding an SDK dependency. These are
 * operator scripts run from CI and a workstation, not application code — the
 * API never touches this file, it builds URLs from the public base URL and a
 * storage key. The trade-off is recorded in docs/dsd-corpus/AUDIO-STORAGE.md:
 * one CLI on the operator's PATH against ~20 MB of transitive SDK in the
 * application's dependency tree.
 *
 * The interface exists so the audit can be tested exhaustively without a live
 * store, and so a real store can be swapped in when one is available.
 */
import { execFileSync } from 'child_process';

export interface StoredObject {
  key: string;
  size: number;
  etag: string;
  /** Non-current versions retained. Content-addressed keys should have none. */
  versionCount: number;
}

export interface BucketConfig {
  versioning: boolean;
  encryption: boolean;
  /** True when anonymous listing is possible, which it must never be. */
  publicListing: boolean;
}

export type PutOutcome = 'created' | 'exists' | 'conflict';

export interface ObjectStore {
  list(prefix: string): Promise<StoredObject[]>;
  get(key: string): Promise<Buffer | null>;
  /**
   * Create only if absent. Never overwrites: the key is a content hash, so an
   * object already there with different bytes is a conflict to report, not a
   * write to redo.
   */
  putIfAbsent(key: string, bytes: Buffer): Promise<PutOutcome>;
  config(): Promise<BucketConfig>;
}

export interface S3Target {
  bucket: string;
  prefix: string;
  region: string;
  endpoint?: string;
}

/** Parse s3://bucket/prefix into its parts. */
export function parseS3Uri(uri: string): { bucket: string; prefix: string } | null {
  const match = /^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])(?:\/(.*))?$/.exec(uri ?? '');
  if (!match) return null;
  return { bucket: match[1], prefix: (match[2] ?? '').replace(/\/$/, '') };
}

export class AwsCliObjectStore implements ObjectStore {
  constructor(private readonly target: S3Target) {}

  private run(args: string[]): string {
    const base = ['--region', this.target.region];
    if (this.target.endpoint) base.push('--endpoint-url', this.target.endpoint);
    return execFileSync('aws', [...base, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  }

  private tryRun(args: string[]): string | null {
    try {
      return this.run(args);
    } catch {
      return null;
    }
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const listed = this.tryRun([
      's3api', 'list-objects-v2',
      '--bucket', this.target.bucket,
      '--prefix', prefix,
      '--output', 'json',
    ]);
    if (!listed) return [];
    const contents: Array<{ Key: string; Size: number; ETag: string }> =
      JSON.parse(listed).Contents ?? [];

    // Version counts come from a separate call; without them a rewritten object
    // is indistinguishable from an original one.
    const versions = this.tryRun([
      's3api', 'list-object-versions',
      '--bucket', this.target.bucket,
      '--prefix', prefix,
      '--output', 'json',
    ]);
    const perKey = new Map<string, number>();
    if (versions) {
      const parsed = JSON.parse(versions);
      for (const entry of [...(parsed.Versions ?? []), ...(parsed.DeleteMarkers ?? [])]) {
        perKey.set(entry.Key, (perKey.get(entry.Key) ?? 0) + 1);
      }
    }

    return contents.map((object) => ({
      key: object.Key,
      size: object.Size,
      etag: (object.ETag ?? '').replace(/"/g, ''),
      // One version is the object itself; anything beyond that is a rewrite.
      versionCount: Math.max(0, (perKey.get(object.Key) ?? 1) - 1),
    }));
  }

  async get(key: string): Promise<Buffer | null> {
    const temp = `/tmp/dsd-audio-${process.pid}-${key.replace(/[^a-z0-9]/gi, '_')}`;
    const result = this.tryRun(['s3api', 'get-object', '--bucket', this.target.bucket, '--key', key, temp]);
    if (!result) return null;
    const fs = require('fs');
    try {
      return fs.readFileSync(temp);
    } finally {
      try {
        fs.unlinkSync(temp);
      } catch {
        /* the read already succeeded or failed; cleanup is best effort */
      }
    }
  }

  async putIfAbsent(key: string, bytes: Buffer): Promise<PutOutcome> {
    const crypto = require('crypto');
    const hash: string = crypto.createHash('sha256').update(bytes).digest('hex');

    // The key must describe the bytes being written. Comparing sizes instead
    // was a real bug: two different one-second WAVs have identical length, so a
    // mismatched write read as "already there" and was silently dropped.
    const embedded = /\/([0-9a-f]{64})\.[a-z0-9]+$/.exec(key)?.[1];
    if (embedded && embedded !== hash) {
      return 'conflict';
    }

    const head = this.tryRun([
      's3api', 'head-object', '--bucket', this.target.bucket, '--key', key, '--output', 'json',
    ]);
    if (head) {
      // Compare content, not length. An object can be corrupted in place at the
      // same size, and that is the case worth catching.
      const existing = await this.get(key);
      if (!existing) return 'conflict';
      const existingHash: string = crypto.createHash('sha256').update(existing).digest('hex');
      return existingHash === hash ? 'exists' : 'conflict';
    }

    const fs = require('fs');
    const temp = `/tmp/dsd-audio-put-${process.pid}`;
    fs.writeFileSync(temp, bytes);
    try {
      this.run(['s3api', 'put-object', '--bucket', this.target.bucket, '--key', key, '--body', temp]);
      return 'created';
    } finally {
      try {
        fs.unlinkSync(temp);
      } catch {
        /* best effort */
      }
    }
  }

  async config(): Promise<BucketConfig> {
    const versioning = this.tryRun([
      's3api', 'get-bucket-versioning', '--bucket', this.target.bucket, '--output', 'json',
    ]);
    const encryption = this.tryRun([
      's3api', 'get-bucket-encryption', '--bucket', this.target.bucket, '--output', 'json',
    ]);
    const policy = this.tryRun([
      's3api', 'get-bucket-policy-status', '--bucket', this.target.bucket, '--output', 'json',
    ]);

    return {
      versioning: !!versioning && JSON.parse(versioning).Status === 'Enabled',
      encryption: !!encryption,
      publicListing: !!policy && JSON.parse(policy).PolicyStatus?.IsPublic === true,
    };
  }
}
