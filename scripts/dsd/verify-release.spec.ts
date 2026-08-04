import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildManifest,
  canonicalJsonBytes,
  checksumsBytes,
  csvBytes,
  sha256,
  signManifestBytes,
} from './lib/release-package';
import { DEFAULT_KEY_REGISTRY, collectFiles, verifyDirectory } from './verify-release';

const NOW = '2026-08-04T12:00:00.000Z';
const KEY_ID = 'DSD-SIGN-TEST';

function keyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

const KEYS = keyPair();

/**
 * Write a small but complete release package to disk.
 *
 * Real files rather than fakes, because the acceptance criteria are about bytes
 * on disk: a changed audio file, an extra file, a rewritten manifest.
 */
function writePackage(root: string, keys = KEYS, keyId = KEY_ID) {
  fs.mkdirSync(path.join(root, 'audio', 'en-aria'), { recursive: true });

  const entriesCsv = csvBytes(['entry_id', 'headword'], [['11111111-1111-1111-1111-111111111111', 'rehearse']]);
  const licence = Buffer.from('# DSD data licence\n', 'utf8');
  const audioBytes = Buffer.from('RIFFfake-wav-bytes', 'utf8');
  const audioHash = sha256(audioBytes);
  const audioPath = `audio/en-aria/${audioHash}.wav`;

  fs.writeFileSync(path.join(root, '01_entries.csv'), entriesCsv);
  fs.writeFileSync(path.join(root, 'DATA-LICENSE.md'), licence);
  fs.writeFileSync(path.join(root, 'RELEASE-PUBLIC-KEY.pem'), keys.publicKeyPem);
  fs.writeFileSync(path.join(root, audioPath), audioBytes);

  const manifest = buildManifest({
    releaseId: 'DSD-REL-V1-5000-a1b2c3d4',
    channel: 'public',
    publicEligible: true,
    sourceDateEpoch: 1_785_000_000,
    auditVersion: 'dsd-release-audit/1.0.0',
    signerKeyId: keyId,
    source: {
      database: 'dsd_corpus_db',
      migration: '1785629400000',
      similarityPolicySha256: 'p'.repeat(64),
      sourceRegistrySha256: '1'.repeat(64),
      toolRegistrySha256: '2'.repeat(64),
      contributorRegistrySha256: '3'.repeat(64),
    },
    counts: { entries: 1, senses: 0, translations: 0, examples: 0, relations: 0, audioAssets: 1 },
    territories: ['VN'],
    artifacts: [
      { path: '01_entries.csv', sha256: sha256(entriesCsv), bytes: entriesCsv.length },
      { path: 'DATA-LICENSE.md', sha256: sha256(licence), bytes: licence.length },
      {
        path: 'RELEASE-PUBLIC-KEY.pem',
        sha256: sha256(Buffer.from(keys.publicKeyPem)),
        bytes: Buffer.from(keys.publicKeyPem).length,
      },
    ],
    audio: [{ path: audioPath, sha256: audioHash, bytes: audioBytes.length }],
  });

  const manifestBytes = canonicalJsonBytes(manifest);
  fs.writeFileSync(path.join(root, '00_manifest.json'), manifestBytes);
  fs.writeFileSync(
    path.join(root, '00_manifest.sig'),
    `${signManifestBytes(manifestBytes, keys.privateKeyPem)}\n`,
  );
  fs.writeFileSync(path.join(root, 'checksums.sha256'), checksumsBytes(manifest));

  return { audioPath, manifest };
}

function writeRegistry(file: string, entries: unknown[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ keys: entries }, null, 2));
}

describe('verifyDirectory', () => {
  let root: string;
  let registry: string;
  let audioPath: string;

  beforeEach(() => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsd-release-'));
    root = path.join(temp, 'package');
    registry = path.join(temp, 'keys.json');
    ({ audioPath } = writePackage(root));
    writeRegistry(registry, [
      { keyId: KEY_ID, algorithm: 'ed25519', publicKeyPem: KEYS.publicKeyPem, status: 'active' },
    ]);
  });

  const verify = () =>
    verifyDirectory({ directory: root, keyRegistryPath: registry, now: NOW });

  it('verifies a good package offline, with no database or network', () => {
    expect(verify()).toEqual([]);
  });

  it('detects a changed data byte', () => {
    fs.appendFileSync(path.join(root, '01_entries.csv'), 'x');
    expect(verify().map((p) => p.code)).toContain('artifact_hash_mismatch');
  });

  it('detects a changed audio byte', () => {
    fs.writeFileSync(path.join(root, audioPath), 'RIFFtampered-bytes');
    expect(verify().map((p) => p.code)).toContain('artifact_hash_mismatch');
  });

  it('detects a deleted artifact', () => {
    fs.unlinkSync(path.join(root, 'DATA-LICENSE.md'));
    expect(verify().map((p) => p.code)).toContain('artifact_missing');
  });

  it('detects a file added after signing', () => {
    fs.writeFileSync(path.join(root, 'EXTRA.md'), 'not signed for');
    expect(verify().map((p) => p.code)).toContain('unexpected_artifact');
  });

  it('detects a rewritten manifest', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, '00_manifest.json'), 'utf8'));
    manifest.counts.entries = 9999;
    fs.writeFileSync(path.join(root, '00_manifest.json'), canonicalJsonBytes(manifest));
    expect(verify().map((p) => p.code)).toContain('signature_invalid');
  });

  it('detects a manifest that is no longer canonical', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, '00_manifest.json'), 'utf8'));
    fs.writeFileSync(path.join(root, '00_manifest.json'), JSON.stringify(manifest));
    expect(verify().map((p) => p.code)).toContain('manifest_hash_mismatch');
  });

  it('detects a missing signature', () => {
    fs.unlinkSync(path.join(root, '00_manifest.sig'));
    expect(verify().map((p) => p.code)).toEqual(['signature_missing']);
  });

  it('detects a revoked key', () => {
    writeRegistry(registry, [
      {
        keyId: KEY_ID,
        algorithm: 'ed25519',
        publicKeyPem: KEYS.publicKeyPem,
        status: 'revoked',
        revokedReason: 'signing host compromised',
      },
    ]);
    // Revocation is retroactive on purpose: the usual reason a key is revoked is
    // that somebody else may have been able to use it.
    expect(verify().map((p) => p.code)).toContain('key_revoked');
  });

  it('detects an unknown key id', () => {
    writeRegistry(registry, []);
    expect(verify().map((p) => p.code)).toContain('key_id_unknown');
  });

  it('does not trust the bundled key over the reviewed registry', () => {
    // A package signed and bundled with a rogue key. A verifier that trusted the
    // bundle would pass this, which is why the registry is the trust root.
    const rogue = keyPair();
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsd-rogue-'));
    const rogueRoot = path.join(temp, 'package');
    writePackage(rogueRoot, rogue, KEY_ID);

    const problems = verifyDirectory({
      directory: rogueRoot,
      keyRegistryPath: registry,
      now: NOW,
    });
    expect(problems.map((p) => p.code)).toContain('signature_invalid');
    expect(problems.map((p) => p.code)).toContain('bundled_key_mismatch');
  });

  it('detects a checksum index that disagrees with the manifest', () => {
    fs.writeFileSync(path.join(root, 'checksums.sha256'), 'deadbeef  01_entries.csv\n');
    expect(verify().map((p) => p.code)).toContain('checksums_mismatch');
  });

  it('reports a missing directory rather than throwing', () => {
    const problems = verifyDirectory({
      directory: path.join(root, 'nope'),
      keyRegistryPath: registry,
      now: NOW,
    });
    expect(problems.map((p) => p.code)).toEqual(['manifest_missing']);
  });

  it('reports every problem at once', () => {
    fs.appendFileSync(path.join(root, '01_entries.csv'), 'x');
    fs.writeFileSync(path.join(root, 'EXTRA.md'), 'x');
    expect(verify().length).toBeGreaterThanOrEqual(2);
  });
});

describe('collectFiles', () => {
  it('uses forward slashes, so a package verifies on any platform', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsd-collect-'));
    fs.mkdirSync(path.join(temp, 'audio', 'en-aria'), { recursive: true });
    fs.writeFileSync(path.join(temp, 'audio', 'en-aria', 'x.wav'), 'bytes');
    expect(Object.keys(collectFiles(temp))).toContain('audio/en-aria/x.wav');
  });
});

describe('the committed key registry', () => {
  const registry = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../..', DEFAULT_KEY_REGISTRY), 'utf8'),
  );

  it('is the documented trust root', () => {
    expect(registry.$comment).toMatch(/trust root/i);
    expect(registry.$comment).toMatch(/never the RELEASE-PUBLIC-KEY\.pem/);
  });

  it('holds no key yet, and says so rather than shipping a placeholder', () => {
    // A placeholder would make every verification appear to have a trust root
    // when it has none.
    expect(registry.keys).toEqual([]);
    expect(registry.$keysComment).toMatch(/refuses to sign/);
  });

  it('documents rotation and revocation', () => {
    expect(registry.rotation.privateKeyLocation).toMatch(/secret store/);
    expect(registry.rotation.policy).toMatch(/One active signing key/);
    expect(registry.revocation.policy).toMatch(/retroactive/);
    expect(registry.revocation.onCompromise.length).toBeGreaterThan(2);
  });

  it('contains no private key material', () => {
    const text = JSON.stringify(registry);
    expect(text).not.toMatch(/PRIVATE KEY/);
    expect(text).not.toMatch(/BEGIN OPENSSH/);
  });
});
