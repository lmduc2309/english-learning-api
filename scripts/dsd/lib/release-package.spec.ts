import * as crypto from 'crypto';
import {
  Manifest,
  ManifestInput,
  NEVER_LISTED,
  PublicKeyEntry,
  VerifyInput,
  buildManifest,
  byteCompare,
  canonical,
  canonicalJsonBytes,
  checksumsBytes,
  csvBytes,
  csvCell,
  jsonlBytes,
  releaseVerifies,
  sha256,
  signManifestBytes,
  verifyRelease,
} from './release-package';

const NOW = '2026-08-04T12:00:00.000Z';

/** A real Ed25519 key pair, generated once per run. */
function keyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

function manifestInput(overrides: Partial<ManifestInput> = {}): ManifestInput {
  return {
    releaseId: 'DSD-REL-V1-5000-a1b2c3d4',
    channel: 'public',
    publicEligible: true,
    sourceDateEpoch: 1_785_000_000,
    auditVersion: 'dsd-release-audit/1.0.0',
    signerKeyId: 'DSD-SIGN-001',
    source: {
      database: 'dsd_corpus_db',
      migration: '1785629400000',
      similarityPolicySha256: 'p'.repeat(64),
      sourceRegistrySha256: '1'.repeat(64),
      toolRegistrySha256: '2'.repeat(64),
      contributorRegistrySha256: '3'.repeat(64),
    },
    counts: { entries: 1, senses: 1, translations: 1, examples: 1, relations: 0, audioAssets: 2 },
    territories: ['VN', 'SG'],
    artifacts: [
      { path: '01_entries.csv', sha256: 'a'.repeat(64), bytes: 100 },
      { path: 'DATA-LICENSE.md', sha256: 'b'.repeat(64), bytes: 200 },
    ],
    audio: [{ path: `audio/en-aria/${'c'.repeat(64)}.mp3`, sha256: 'c'.repeat(64), bytes: 300 }],
    ...overrides,
  };
}

describe('canonical serialization', () => {
  it('sorts keys, so two runs produce identical bytes', () => {
    const a = canonicalJsonBytes({ b: 1, a: 2, c: { z: 1, y: 2 } });
    const b = canonicalJsonBytes({ c: { y: 2, z: 1 }, a: 2, b: 1 });
    expect(a.equals(b)).toBe(true);
  });

  it('keeps array order, which is meaningful', () => {
    expect(canonical([3, 1, 2])).toEqual([3, 1, 2]);
  });

  it('drops undefined rather than emitting null', () => {
    expect(canonicalJsonBytes({ a: 1, b: undefined }).toString()).toBe('{\n  "a": 1\n}\n');
  });

  it('ends with exactly one newline', () => {
    const bytes = canonicalJsonBytes({ a: 1 });
    expect(bytes.toString().endsWith('}\n')).toBe(true);
    expect(bytes.toString().endsWith('}\n\n')).toBe(false);
  });

  it('sorts by byte value, not by locale', () => {
    // localeCompare varies with ICU version, which would make a package's byte
    // layout depend on the host that built it.
    expect(byteCompare('Z', 'a')).toBeLessThan(0);
    expect('Z'.localeCompare('a')).toBeGreaterThan(0);
  });
});

describe('CSV', () => {
  it('quotes every cell, whether or not it needs it', () => {
    // "Quote only when necessary" is exactly the rule that drifts between
    // implementations and changes bytes.
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell(42)).toBe('"42"');
  });

  it('doubles internal quotes', () => {
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
  });

  it.each(['=cmd', '+1', '-1', '@SUM'])('neutralises the formula prefix %s', (value) => {
    expect(csvCell(value)).toBe(`"'${value}"`);
  });

  it('emits an empty cell for null and undefined', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it('uses LF and one trailing newline, with no BOM', () => {
    const bytes = csvBytes(['a', 'b'], [['1', '2']]);
    expect(bytes.toString()).toBe('"a","b"\n"1","2"\n');
    expect(bytes[0]).not.toBe(0xef);
  });

  it('emits a header even with no rows', () => {
    expect(csvBytes(['a'], []).toString()).toBe('"a"\n');
  });
});

describe('JSONL', () => {
  it('writes one canonical object per line', () => {
    expect(jsonlBytes([{ b: 1, a: 2 }]).toString()).toBe('{"a":2,"b":1}\n');
  });

  it('writes nothing at all for no records', () => {
    expect(jsonlBytes([]).length).toBe(0);
  });
});

describe('buildManifest', () => {
  it('sorts artifacts, audio and territories', () => {
    const manifest = buildManifest(
      manifestInput({
        artifacts: [
          { path: 'DATA-LICENSE.md', sha256: 'b'.repeat(64), bytes: 200 },
          { path: '01_entries.csv', sha256: 'a'.repeat(64), bytes: 100 },
        ],
      }),
    );
    expect(manifest.artifacts.map((a) => a.path)).toEqual(['01_entries.csv', 'DATA-LICENSE.md']);
    expect(manifest.territories).toEqual(['SG', 'VN']);
  });

  it('is byte-identical for the same input in any order', () => {
    const first = canonicalJsonBytes(buildManifest(manifestInput()));
    const second = canonicalJsonBytes(
      buildManifest(
        manifestInput({
          territories: ['SG', 'VN'],
          artifacts: [...manifestInput().artifacts].reverse(),
        }),
      ),
    );
    expect(first.equals(second)).toBe(true);
  });

  it.each(NEVER_LISTED)('never lists %s as a content artifact', (path) => {
    // A manifest cannot contain its own hash, nor the hash of a signature over
    // itself.
    const manifest = buildManifest(
      manifestInput({
        artifacts: [
          ...manifestInput().artifacts,
          { path, sha256: 'f'.repeat(64), bytes: 1 },
        ],
      }),
    );
    expect(manifest.artifacts.map((a) => a.path)).not.toContain(path);
  });

  it('records the epoch, without which the build cannot be reproduced', () => {
    expect(buildManifest(manifestInput()).source_date_epoch).toBe(1_785_000_000);
  });

  it('records the signer key id and algorithm', () => {
    const manifest = buildManifest(manifestInput());
    expect(manifest.signer_key_id).toBe('DSD-SIGN-001');
    expect(manifest.signature_algorithm).toBe('ed25519');
  });
});

describe('checksumsBytes', () => {
  it('is derived from the manifest, so the two cannot disagree', () => {
    const manifest = buildManifest(manifestInput());
    const text = checksumsBytes(manifest).toString();
    expect(text).toContain(`${'a'.repeat(64)}  01_entries.csv`);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('lists audio alongside data artifacts, sorted together', () => {
    const lines = checksumsBytes(buildManifest(manifestInput())).toString().trim().split('\n');
    const paths = lines.map((line) => line.split('  ')[1]);
    expect(paths).toEqual([...paths].sort(byteCompare));
    expect(paths.some((path) => path.startsWith('audio/'))).toBe(true);
  });
});

// ─── signing and verification ───────────────────────────────────────────────

function packageFor(manifest: Manifest, keys: { publicKeyPem: string; privateKeyPem: string }) {
  const manifestBytes = canonicalJsonBytes(manifest);
  const signature = signManifestBytes(manifestBytes, keys.privateKeyPem);
  const presentFiles: Record<string, { sha256: string; bytes: number }> = {};
  for (const artifact of [...manifest.artifacts, ...manifest.audio]) {
    presentFiles[artifact.path] = { sha256: artifact.sha256, bytes: artifact.bytes };
  }
  return { manifestBytes, signature, presentFiles };
}

function verifyInput(overrides: Partial<VerifyInput> = {}): VerifyInput {
  const keys = KEYS;
  const manifest = buildManifest(manifestInput());
  const built = packageFor(manifest, keys);
  return {
    manifestBytes: built.manifestBytes,
    signatureBase64: built.signature,
    trustedKeys: [
      { keyId: 'DSD-SIGN-001', algorithm: 'ed25519', publicKeyPem: keys.publicKeyPem, status: 'active' },
    ],
    bundledKeyPem: keys.publicKeyPem,
    presentFiles: built.presentFiles,
    checksumsBytes: checksumsBytes(manifest),
    now: NOW,
    ...overrides,
  };
}

const KEYS = keyPair();

describe('signing', () => {
  it('signs the canonical manifest bytes', () => {
    const manifest = buildManifest(manifestInput());
    const signature = signManifestBytes(canonicalJsonBytes(manifest), KEYS.privateKeyPem);
    expect(signature).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('refuses a key that is not ed25519', () => {
    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(() =>
      signManifestBytes(
        Buffer.from('x'),
        rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      ),
    ).toThrow(/must be ed25519/);
  });

  it('produces the same signature for the same bytes', () => {
    // Ed25519 is deterministic, which means a re-signed identical package has an
    // identical detached signature.
    const bytes = canonicalJsonBytes(buildManifest(manifestInput()));
    expect(signManifestBytes(bytes, KEYS.privateKeyPem)).toBe(
      signManifestBytes(bytes, KEYS.privateKeyPem),
    );
  });
});

describe('verifyRelease — a good package', () => {
  it('verifies', () => {
    const problems = verifyRelease(verifyInput());
    expect(problems).toEqual([]);
    expect(releaseVerifies(problems)).toBe(true);
  });
});

describe('verifyRelease — what it catches', () => {
  it('a missing manifest', () => {
    const problems = verifyRelease(verifyInput({ manifestBytes: null }));
    expect(problems.map((p) => p.code)).toEqual(['manifest_missing']);
  });

  it('a missing signature', () => {
    expect(verifyRelease(verifyInput({ signatureBase64: null })).map((p) => p.code)).toEqual([
      'signature_missing',
    ]);
  });

  it('a changed byte in the manifest', () => {
    const tampered = canonicalJsonBytes({
      ...buildManifest(manifestInput()),
      release_id: 'DSD-REL-V1-20000-deadbeef',
    });
    const problems = verifyRelease(verifyInput({ manifestBytes: tampered }));
    expect(problems.map((p) => p.code)).toContain('signature_invalid');
  });

  it('a manifest rewritten out of canonical form', () => {
    const manifest = buildManifest(manifestInput());
    const rewritten = Buffer.from(JSON.stringify(manifest) + '\n', 'utf8');
    const problems = verifyRelease(verifyInput({ manifestBytes: rewritten }));
    expect(problems.map((p) => p.code)).toContain('manifest_hash_mismatch');
  });

  it('an unknown signer key id', () => {
    const problems = verifyRelease(verifyInput({ trustedKeys: [] }));
    expect(problems.map((p) => p.code)).toContain('key_id_unknown');
  });

  it('a revoked key', () => {
    const problems = verifyRelease(
      verifyInput({
        trustedKeys: [
          {
            keyId: 'DSD-SIGN-001',
            algorithm: 'ed25519',
            publicKeyPem: KEYS.publicKeyPem,
            status: 'revoked',
            revokedReason: 'signing host compromised',
          },
        ],
      }),
    );
    expect(problems.map((p) => p.code)).toContain('key_revoked');
    expect(problems.find((p) => p.code === 'key_revoked')!.detail).toContain('compromised');
  });

  it('an expired key', () => {
    const problems = verifyRelease(
      verifyInput({
        trustedKeys: [
          {
            keyId: 'DSD-SIGN-001',
            algorithm: 'ed25519',
            publicKeyPem: KEYS.publicKeyPem,
            status: 'active',
            notAfter: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    );
    expect(problems.map((p) => p.code)).toContain('key_expired');
  });

  it('a bundled key that does not match the reviewed registry', () => {
    // The bundled key is informational. Anyone who can change the manifest can
    // change a key sitting next to it, so trust comes from the registry.
    const other = keyPair();
    const problems = verifyRelease(verifyInput({ bundledKeyPem: other.publicKeyPem }));
    expect(problems.map((p) => p.code)).toContain('bundled_key_mismatch');
  });

  it('does not trust the bundled key over the registry', () => {
    // Signed with a key that is NOT in the registry, and bundled alongside. A
    // verifier that trusted the bundle would pass this.
    const rogue = keyPair();
    const manifest = buildManifest(manifestInput());
    const manifestBytes = canonicalJsonBytes(manifest);
    const problems = verifyRelease(
      verifyInput({
        manifestBytes,
        signatureBase64: signManifestBytes(manifestBytes, rogue.privateKeyPem),
        bundledKeyPem: rogue.publicKeyPem,
      }),
    );
    expect(problems.map((p) => p.code)).toContain('signature_invalid');
  });

  it('a changed audio file', () => {
    const input = verifyInput();
    const audioPath = Object.keys(input.presentFiles).find((path) => path.startsWith('audio/'))!;
    input.presentFiles[audioPath] = { sha256: 'f'.repeat(64), bytes: 300 };
    const problems = verifyRelease(input);
    expect(problems.map((p) => p.code)).toContain('artifact_hash_mismatch');
  });

  it('a changed data file', () => {
    const input = verifyInput();
    input.presentFiles['01_entries.csv'] = { sha256: 'f'.repeat(64), bytes: 100 };
    expect(verifyRelease(input).map((p) => p.code)).toContain('artifact_hash_mismatch');
  });

  it('a file whose size disagrees with the manifest', () => {
    const input = verifyInput();
    input.presentFiles['01_entries.csv'] = {
      sha256: 'a'.repeat(64),
      bytes: 101,
    };
    expect(verifyRelease(input).map((p) => p.code)).toContain('artifact_hash_mismatch');
  });

  it('a missing artifact', () => {
    const input = verifyInput();
    delete input.presentFiles['01_entries.csv'];
    expect(verifyRelease(input).map((p) => p.code)).toContain('artifact_missing');
  });

  it('an extra file nobody signed for', () => {
    const input = verifyInput();
    input.presentFiles['README-extra.txt'] = { sha256: 'e'.repeat(64), bytes: 10 };
    expect(verifyRelease(input).map((p) => p.code)).toContain('unexpected_artifact');
  });

  it.each(NEVER_LISTED)('does not treat %s as an unexpected file', (path) => {
    const input = verifyInput();
    input.presentFiles[path] = { sha256: 'e'.repeat(64), bytes: 10 };
    expect(verifyRelease(input).map((p) => p.code)).not.toContain('unexpected_artifact');
  });

  it('a checksum index that disagrees with the manifest', () => {
    const problems = verifyRelease(
      verifyInput({ checksumsBytes: Buffer.from('deadbeef  01_entries.csv\n') }),
    );
    expect(problems.map((p) => p.code)).toContain('checksums_mismatch');
  });

  it('reports every problem at once', () => {
    const input = verifyInput();
    delete input.presentFiles['01_entries.csv'];
    input.presentFiles['extra.txt'] = { sha256: 'e'.repeat(64), bytes: 1 };
    input.trustedKeys = [];
    expect(verifyRelease(input).length).toBeGreaterThanOrEqual(3);
  });
});

describe('sha256', () => {
  it('hashes bytes', () => {
    expect(sha256(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
