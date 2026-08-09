import * as crypto from 'crypto';
import { DsdCorpusConfig } from './dsd-corpus.config';
import { verifyActiveRelease } from './dsd-corpus.module';

const RELEASE = 'DSD-REL-V1-5000-a1b2c3d4';
const pair = crypto.generateKeyPairSync('ed25519');
const trustedKeys = [{
  keyId: 'DSD-SIGN-001',
  algorithm: 'ed25519',
  status: 'active' as const,
  publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
}];

function config(overrides: Partial<DsdCorpusConfig> = {}): DsdCorpusConfig {
  return {
    database: 'dsd_corpus_db',
    releaseChannel: 'public',
    activeReleaseId: RELEASE,
    connections: {},
    errors: [],
    ...overrides,
  };
}

function source(row?: Partial<Record<string, unknown>>) {
  const manifestBytes = JSON.stringify({
    manifest_version: 2,
    release_id: RELEASE,
    channel: 'public',
    counts: {
      entries: 5000,
      senses: 1,
      translations: 1,
      examples: 1,
      pronunciations: 1,
      relations: 0,
      audioAssets: 2,
    },
  }) + '\n';
  return {
    query: jest.fn().mockResolvedValue([
      {
        channel: 'public',
        publicEligible: true,
        entryCount: 5000,
        memberCount: 5000,
        senseCount: 1,
        translationCount: 1,
        exampleCount: 1,
        pronunciationCount: 1,
        relationCount: 0,
        audioAssetCount: 2,
        manifestSha256: crypto.createHash('sha256').update(manifestBytes).digest('hex'),
        signerKeyId: 'DSD-SIGN-001',
        signature: crypto.sign(null, Buffer.from(manifestBytes), pair.privateKey).toString('base64'),
        signatureAlgorithm: 'ed25519',
        manifestBytes,
        ...row,
      },
    ]),
  };
}

describe('verifyActiveRelease', () => {
  it('accepts one complete signed build whose count matches its id', async () => {
    const dataSource = source();
    await expect(
      verifyActiveRelease(dataSource as any, config(), trustedKeys),
    ).resolves.toBeUndefined();
    expect(dataSource.query).toHaveBeenCalledWith(expect.any(String), [RELEASE]);
  });

  it('refuses an id with no recorded build', async () => {
    await expect(
      verifyActiveRelease(
        { query: jest.fn().mockResolvedValue([]) } as any,
        config(),
        trustedKeys,
      ),
    ).rejects.toThrow(/not a complete recorded build/);
  });

  it('refuses count encoded in the id when the build has fewer entries', async () => {
    await expect(
      verifyActiveRelease(
        source({ entryCount: 4999, memberCount: 4999 }) as any,
        config(),
        trustedKeys,
      ),
    ).rejects.toThrow(/declares 5000.*contains 4999/);
  });

  it('refuses incomplete membership', async () => {
    await expect(
      verifyActiveRelease(source({ memberCount: 4999 }) as any, config(), trustedKeys),
    ).rejects.toThrow(/incomplete membership/);
  });

  it('refuses child membership that differs from the signed manifest', async () => {
    await expect(
      verifyActiveRelease(source({ audioAssetCount: 1 }) as any, config(), trustedKeys),
    ).rejects.toThrow(/signed audioAssets count.*exact database membership/);
  });

  it('refuses an internal build on the public channel', async () => {
    await expect(
      verifyActiveRelease(source({ channel: 'internal' }) as any, config(), trustedKeys),
    ).rejects.toThrow(/built for 'internal'/);
  });

  it('refuses missing signing metadata', async () => {
    await expect(
      verifyActiveRelease(
        source({ manifestSha256: '', signerKeyId: '' }) as any,
        config(),
        trustedKeys,
      ),
    ).rejects.toThrow(/incomplete signing metadata/);
  });

  it('refuses a manifest whose bytes or signature were changed after signing', async () => {
    await expect(
      verifyActiveRelease(
        source({ manifestBytes: '{"tampered":true}\n' }) as any,
        config(),
        trustedKeys,
      ),
    ).rejects.toThrow(/manifest hash does not match/);
    await expect(
      verifyActiveRelease(
        source({ signature: Buffer.from('bad').toString('base64') }) as any,
        config(),
        trustedKeys,
      ),
    ).rejects.toThrow(/signature is invalid/);
  });

  it('refuses an unknown or revoked signing key', async () => {
    await expect(
      verifyActiveRelease(source() as any, config(), []),
    ).rejects.toThrow(/signer is not trusted/);
    await expect(
      verifyActiveRelease(source() as any, config(), [{ ...trustedKeys[0], status: 'revoked' }]),
    ).rejects.toThrow(/signer is not trusted/);
  });
});
