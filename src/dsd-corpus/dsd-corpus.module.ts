import { DynamicModule, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  DsdCorpusConfig,
  assessReleaseId,
  buildDsdCorpusConfig,
  dsdMustBeAvailable,
} from './dsd-corpus.config';
import { createDsdDataSource } from './dsd-corpus.datasource';
import { DsdCorpusController } from './dsd-corpus.controller';
import { DsdQueryService } from './dsd-query.service';
import { AuthModule } from '../auth/auth.module';
import { DsdReviewerGuard } from './dsd-reviewer.guard';

export const DSD_DATA_SOURCE = 'DSD_DATA_SOURCE';
export const DSD_CORPUS_CONFIG = 'DSD_CORPUS_CONFIG';
export const DSD_ACTIVE_MANIFEST_VERSION = 2;

interface ServingReleaseRow {
  channel: 'internal' | 'public';
  publicEligible: boolean;
  entryCount: number;
  memberCount: number;
  senseCount: number;
  translationCount: number;
  exampleCount: number;
  pronunciationCount: number;
  relationCount: number;
  audioAssetCount: number;
  manifestSha256: string;
  signerKeyId: string;
  signature: string;
  signatureAlgorithm: string;
  manifestBytes: string;
}

export interface TrustedReleaseKey {
  keyId: string;
  algorithm: string;
  publicKeyPem: string;
  status: 'active' | 'revoked';
  notAfter?: string;
}

function loadTrustedReleaseKeys(): TrustedReleaseKey[] {
  const file = path.resolve(
    process.cwd(),
    process.env.DSD_RELEASE_PUBLIC_KEYS_FILE || 'data/dsd/release-public-keys.json',
  );
  const registry = JSON.parse(fs.readFileSync(file, 'utf8'));
  return registry.keys ?? [];
}

/** Refuse activation unless the id resolves to one complete signed build. */
export async function verifyActiveRelease(
  dataSource: Pick<DataSource, 'query'>,
  config: DsdCorpusConfig,
  trustedKeys: TrustedReleaseKey[] = loadTrustedReleaseKeys(),
): Promise<void> {
  const rows: ServingReleaseRow[] = await dataSource.query(
    `SELECT "channel", "public_eligible" AS "publicEligible",
            "entry_count" AS "entryCount", count(*)::int AS "memberCount",
            min("sense_count") AS "senseCount",
            min("translation_count") AS "translationCount",
            min("example_count") AS "exampleCount",
            min("pronunciation_count") AS "pronunciationCount",
            min("relation_count") AS "relationCount",
            min("audio_asset_count") AS "audioAssetCount",
            min("manifest_sha256") AS "manifestSha256",
            min("signer_key_id") AS "signerKeyId",
            min("signature") AS "signature",
            min("signature_algorithm") AS "signatureAlgorithm",
            min("manifest_bytes") AS "manifestBytes"
       FROM dsd_serving_release_entries
      WHERE "release_id" = $1
      GROUP BY "channel", "public_eligible", "entry_count"`,
    [config.activeReleaseId],
  );
  if (rows.length !== 1) {
    throw new Error(
      `DSD active release '${config.activeReleaseId}' is not a complete recorded build`,
    );
  }
  const row = rows[0];
  const eligibility = assessReleaseId(config.activeReleaseId);
  if (row.channel !== config.releaseChannel) {
    throw new Error(
      `DSD active release '${config.activeReleaseId}' was built for '${row.channel}', not '${config.releaseChannel}'`,
    );
  }
  if (row.entryCount !== row.memberCount) {
    throw new Error(`DSD active release '${config.activeReleaseId}' has incomplete membership`);
  }
  if (
    eligibility.declaredEntries !== null
    && eligibility.declaredEntries !== row.entryCount
  ) {
    throw new Error(
      `DSD active release '${config.activeReleaseId}' declares ${eligibility.declaredEntries} ` +
        `entries but its signed build contains ${row.entryCount}`,
    );
  }
  if (config.releaseChannel === 'public' && !row.publicEligible) {
    throw new Error(`DSD active release '${config.activeReleaseId}' is not public-eligible`);
  }
  if (!/^[0-9a-f]{64}$/.test(row.manifestSha256) || !row.signerKeyId.trim()) {
    throw new Error(`DSD active release '${config.activeReleaseId}' has incomplete signing metadata`);
  }
  const manifestBytes = Buffer.from(row.manifestBytes ?? '', 'utf8');
  const actualManifestHash = crypto.createHash('sha256').update(manifestBytes).digest('hex');
  if (actualManifestHash !== row.manifestSha256) {
    throw new Error(`DSD active release '${config.activeReleaseId}' manifest hash does not match`);
  }
  let manifest: any;
  try {
    manifest = JSON.parse(row.manifestBytes);
  } catch {
    throw new Error(`DSD active release '${config.activeReleaseId}' manifest is not valid JSON`);
  }
  if (
    manifest.manifest_version !== DSD_ACTIVE_MANIFEST_VERSION
    ||
    manifest.release_id !== config.activeReleaseId
    || manifest.channel !== config.releaseChannel
    || manifest.counts?.entries !== row.entryCount
  ) {
    throw new Error(`DSD active release '${config.activeReleaseId}' manifest metadata does not match`);
  }
  const signedCounts = manifest.counts ?? {};
  const countPairs: Array<[string, unknown, number]> = [
    ['senses', signedCounts.senses, row.senseCount],
    ['translations', signedCounts.translations, row.translationCount],
    ['examples', signedCounts.examples, row.exampleCount],
    ['pronunciations', signedCounts.pronunciations, row.pronunciationCount],
    ['relations', signedCounts.relations, row.relationCount],
    ['audioAssets', signedCounts.audioAssets, row.audioAssetCount],
  ];
  const countMismatch = countPairs.find(([, signed, recorded]) => signed !== recorded);
  if (countMismatch) {
    throw new Error(
      `DSD active release '${config.activeReleaseId}' signed ${countMismatch[0]} count ` +
        'does not match its exact database membership',
    );
  }
  const key = trustedKeys.find((candidate) => candidate.keyId === row.signerKeyId);
  if (
    !key
    || key.status !== 'active'
    || key.algorithm !== 'ed25519'
    || row.signatureAlgorithm !== 'ed25519'
    || (key.notAfter && (
      !Number.isFinite(Date.parse(key.notAfter)) || Date.parse(key.notAfter) < Date.now()
    ))
  ) {
    throw new Error(`DSD active release '${config.activeReleaseId}' signer is not trusted`);
  }
  let publicKey: crypto.KeyObject;
  try {
    publicKey = crypto.createPublicKey(key.publicKeyPem);
  } catch {
    throw new Error(`DSD active release '${config.activeReleaseId}' signer key is invalid`);
  }
  if (
    publicKey.asymmetricKeyType !== 'ed25519'
    || !crypto.verify(null, manifestBytes, publicKey, Buffer.from(row.signature, 'base64'))
  ) {
    throw new Error(`DSD active release '${config.activeReleaseId}' signature is invalid`);
  }
}

/**
 * Wires the DSD corpus into the application as the `dsd_app` role only.
 *
 * Fail-closed by release channel:
 *   `internal` / `public` — DSD is serving, so an unavailable connection is a
 *                           startup failure.
 *   `off`                 — DSD serves nothing; user, auth and progress routes
 *                           stay healthy and dictionary routes return 404.
 *                           They never fall back to legacy content.
 */
@Module({})
export class DsdCorpusModule implements OnApplicationBootstrap {
  private static readonly logger = new Logger('DsdCorpusModule');

  static forRoot(config: DsdCorpusConfig = buildDsdCorpusConfig()): DynamicModule {
    const required = dsdMustBeAvailable(config.releaseChannel);

    if (required && config.errors.length > 0) {
      // Refuse to boot rather than serve a channel we cannot back.
      throw new Error(
        `DSD release channel is '${config.releaseChannel}' but its configuration is invalid:\n  - ` +
          config.errors.join('\n  - '),
      );
    }

    return {
      module: DsdCorpusModule,
      global: true,
      imports: [AuthModule],
      controllers: [DsdCorpusController],
      providers: [
        DsdQueryService,
        DsdReviewerGuard,
        { provide: DSD_CORPUS_CONFIG, useValue: config },
        {
          provide: DSD_DATA_SOURCE,
          useFactory: async (): Promise<DataSource | null> => {
            if (!required) {
              DsdCorpusModule.logger.log(
                `DSD release channel is 'off'; DSD data source not initialized.`,
              );
              return null;
            }

            const dataSource = createDsdDataSource('app', config);
            await dataSource.initialize();
            try {
              await verifyActiveRelease(dataSource, config);
            } catch (error) {
              await dataSource.destroy();
              throw error;
            }
            DsdCorpusModule.logger.log(
              `DSD data source connected as 'dsd_app' to '${config.database}' (channel: ${config.releaseChannel}).`,
            );
            return dataSource;
          },
        },
      ],
      exports: [DSD_DATA_SOURCE, DSD_CORPUS_CONFIG, DsdQueryService],
    };
  }

  onApplicationBootstrap(): void {
    // Task 15 adds the routing assertions that depend on this module.
  }
}
