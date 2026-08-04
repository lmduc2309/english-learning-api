/**
 * Build a deterministic, signed DSD release package.
 *
 * Two exports from the same database snapshot and the same SOURCE_DATE_EPOCH
 * must produce byte-identical output. That is not a nicety — it is what lets a
 * customer, or a court, check a package against its manifest without trusting
 * the machine that built it.
 *
 * The order of operations is deliberate and each step gates the next:
 *
 *   1. **Audit first.** The output directory is not created until the release
 *      audit returns GO. A half-written package from a failed audit is a package
 *      somebody will eventually ship.
 *   2. **Smoke-test the native module.** better-sqlite3 is loaded and exercised
 *      before anything is written, so an ABI mismatch fails immediately rather
 *      than after twenty minutes of copying audio.
 *   3. **Read in one repeatable-read, read-only transaction.** Every row comes
 *      from a single consistent snapshot, and the transaction cannot write.
 *   4. **Refuse to overwrite.** A new directory or nothing.
 *   5. **Stream audio and verify while copying.** The object hash is checked as
 *      the bytes go past, so a corrupt object fails the export rather than
 *      shipping.
 *   6. **Sign the manifest, then verify the package**, then record the build in
 *      a separate short write transaction. A record of a build that failed
 *      verification would be worse than no record.
 *
 * What is deliberately excluded: candidates, drafts, rejected rows, contributor
 * names, evidence-store locations, and anything legacy. PROVENANCE.jsonl proves
 * separation of duties using release-scoped pseudonyms, which is enough to show
 * that author and reviewer differed without publishing who they are.
 *
 * USAGE:
 *   SOURCE_DATE_EPOCH=1785000000 npm run dsd:export -- \
 *     --release DSD-REL-V1-5000-a1b2c3d4 --channel public \
 *     --territories data/dsd/releases/territories.json
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { buildDsdCorpusConfig } from '../../src/dsd-corpus/dsd-corpus.config';
import { createDsdDataSource } from '../../src/dsd-corpus/dsd-corpus.datasource';
import {
  Manifest,
  ManifestArtifact,
  buildManifest,
  byteCompare,
  canonicalJsonBytes,
  checksumsBytes,
  csvBytes,
  jsonlBytes,
  sha256,
  signManifestBytes,
  verifyRelease,
} from './lib/release-package';

dotenv.config();

export const OUTPUT_ROOT = 'dist/dsd-corpus';

// ─── deterministic row shapes ───────────────────────────────────────────────

/**
 * Column orders, fixed forever.
 *
 * Reordering a column changes every byte after it, which would break the
 * signature of every package built before the change. Adding one is a new
 * manifest version, not an edit.
 */
export const CSV_SCHEMA = {
  entries: ['entry_id', 'headword', 'headword_normalized', 'language', 'dsd_band'],
  senses: ['sense_id', 'entry_id', 'sense_order', 'part_of_speech', 'definition_en', 'usage_labels'],
  translations: ['translation_id', 'sense_id', 'locale', 'text'],
  examples: ['example_id', 'sense_id', 'example_order', 'example_en', 'example_vi'],
  pronunciations: ['pronunciation_id', 'entry_id', 'accent', 'ipa', 'priority'],
  relations: ['relation_id', 'sense_id', 'related_sense_id', 'relation_type'],
  audio: ['asset_id', 'entry_id', 'pronunciation_id', 'voice', 'format', 'media_type', 'duration_ms', 'sample_rate', 'sha256', 'path'],
} as const;

/** Fields PROVENANCE.jsonl may contain. Everything else is excluded by name. */
export const PROVENANCE_FIELDS = [
  'entity_kind',
  'entity_id',
  'event_type',
  'actor_ref',
  'output_hash',
  'occurred_on',
] as const;

/**
 * A release-scoped pseudonym for a contributor.
 *
 * Salted with the release id so the same person is a different reference in
 * every release — two packages cannot be correlated to build a picture of who
 * works on what. Within one package the mapping is stable, which is exactly
 * enough to prove that an author and a reviewer were different people.
 */
export function actorRef(releaseId: string, actor: string): string {
  return crypto
    .createHash('sha256')
    .update(`dsd.actor.v1 ${releaseId} ${actor}`, 'utf8')
    .digest('hex')
    .slice(0, 16);
}

/** Dates only, never times: an event time is closer to personal data. */
export function occurredOn(timestamp: string | Date): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

// ─── queries, all deterministically ordered ─────────────────────────────────

const Q = {
  entries: `
    SELECT e.id AS entry_id, e.headword, e.headword_normalized, e.language, e.dsd_band
      FROM dsd_entries e WHERE e.status = 'published' ORDER BY e.id`,
  senses: `
    SELECT s.id AS sense_id, s.dsd_entry_id AS entry_id, s.sense_order,
           s.part_of_speech, s.definition_en, s.usage_labels
      FROM dsd_senses s JOIN dsd_entries e ON e.id = s.dsd_entry_id
     WHERE s.status = 'published' AND e.status = 'published' ORDER BY s.id`,
  translations: `
    SELECT t.id AS translation_id, t.dsd_sense_id AS sense_id, t.locale, t.text
      FROM dsd_translations t
      JOIN dsd_senses s ON s.id = t.dsd_sense_id
      JOIN dsd_entries e ON e.id = s.dsd_entry_id
     WHERE t.status = 'published' AND s.status = 'published' AND e.status = 'published'
     ORDER BY t.id`,
  examples: `
    SELECT x.id AS example_id, x.dsd_sense_id AS sense_id, x.example_order,
           x.example_en, x.example_vi
      FROM dsd_examples x
      JOIN dsd_senses s ON s.id = x.dsd_sense_id
      JOIN dsd_entries e ON e.id = s.dsd_entry_id
     WHERE x.status = 'published' AND s.status = 'published' AND e.status = 'published'
     ORDER BY x.id`,
  pronunciations: `
    SELECT p.id AS pronunciation_id, p.dsd_entry_id AS entry_id, p.accent, p.ipa, p.priority
      FROM dsd_pronunciations p JOIN dsd_entries e ON e.id = p.dsd_entry_id
     WHERE p.status = 'published' AND e.status = 'published' ORDER BY p.id`,
  relations: `
    SELECT r.id AS relation_id, r.sense_id, r.related_sense_id, r.relation_type
      FROM dsd_serving_relations r ORDER BY r.id, r.sense_id`,
  audio: `
    SELECT a.id AS asset_id, a.dsd_entry_id AS entry_id,
           a.input_record_id AS pronunciation_id, a.public_voice_id AS voice,
           a.format, a.media_type, a.duration_ms, a.sample_rate,
           a.audio_sha256 AS sha256, a.storage_key
      FROM dsd_audio_assets a JOIN dsd_entries e ON e.id = a.dsd_entry_id
     WHERE a.review_status = 'accepted' AND a.training_dataset_status = 'approved'
       AND a.qa_findings = '[]'::jsonb AND e.status = 'published'
     ORDER BY a.id`,
  provenance: `
    SELECT pe.entity_kind, pe.entity_id, pe.event_type, pe.actor,
           pe.output_hash, pe.occurred_at
      FROM dsd_provenance_events pe
     ORDER BY pe.entity_kind, pe.entity_id, pe.occurred_at, pe.id`,
  migration: `SELECT max(timestamp)::text AS version FROM dsd_migrations`,
};

// ─── SQLite ─────────────────────────────────────────────────────────────────

/**
 * Load and exercise better-sqlite3 before anything is written.
 *
 * A native ABI mismatch is the failure most likely to appear only in a fresh
 * environment, and the worst time to discover it is after the audio has been
 * copied.
 */
export function smokeTestSqlite(): { ok: true; sqliteVersion: string } {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE smoke(a TEXT)');
    db.prepare('INSERT INTO smoke(a) VALUES (?)').run('x');
    const row = db.prepare('SELECT a FROM smoke').get();
    if (row?.a !== 'x') throw new Error('better-sqlite3 did not round-trip a value');
    const version = db.prepare('SELECT sqlite_version() AS v').get().v as string;
    return { ok: true, sqliteVersion: version };
  } finally {
    db.close();
  }
}

/**
 * Build the SQLite artifact deterministically.
 *
 * Page size and encoding are pinned, the journal is off, rows go in in the same
 * order they appear in the CSVs, and `VACUUM INTO` writes a freshly packed file
 * so no free-page layout from insertion order survives. SQLite still stamps a
 * change counter in the header, so the file is normalised afterwards.
 */
export function buildSqlite(
  destination: string,
  tables: Record<string, { columns: readonly string[]; rows: Array<Array<string | number | null>> }>,
): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  const staging = `${destination}.staging`;
  for (const file of [destination, staging]) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  const db = new Database(staging);
  try {
    db.pragma('page_size = 4096');
    db.pragma('encoding = "UTF-8"');
    db.pragma('journal_mode = OFF');
    db.pragma('auto_vacuum = NONE');

    for (const [name, table] of Object.entries(tables)) {
      const columns = table.columns.map((column) => `"${column}" TEXT`).join(', ');
      db.exec(`CREATE TABLE "${name}" (${columns})`);
      const placeholders = table.columns.map(() => '?').join(', ');
      const insert = db.prepare(`INSERT INTO "${name}" VALUES (${placeholders})`);
      const insertAll = db.transaction((rows: Array<Array<string | number | null>>) => {
        for (const row of rows) insert.run(row.map((value) => (value === null ? null : String(value))));
      });
      insertAll(table.rows);
    }

    db.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
  } finally {
    db.close();
    if (fs.existsSync(staging)) fs.unlinkSync(staging);
  }

  normalizeSqliteHeader(destination);
}

/**
 * Zero the header fields SQLite varies between otherwise identical builds.
 *
 * Bytes 24–27 are the file change counter and 92–95 the version-valid-for
 * number; both track write history rather than content. Leaving them in would
 * make two exports of the same data differ, which is the one thing this whole
 * file exists to prevent.
 */
export function normalizeSqliteHeader(file: string): void {
  const handle = fs.openSync(file, 'r+');
  try {
    const zeros = Buffer.alloc(4, 0);
    fs.writeSync(handle, zeros, 0, 4, 24);
    fs.writeSync(handle, zeros, 0, 4, 92);
  } finally {
    fs.closeSync(handle);
  }
}

// ─── I/O helpers ────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readJsonIfPresent(file: string): any | null {
  const resolved = path.resolve(process.cwd(), file);
  if (!fs.existsSync(resolved)) return null;
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

export interface WrittenFile {
  path: string;
  bytes: Buffer;
}

/** Write every file, then describe them for the manifest. */
export function describeArtifacts(files: WrittenFile[]): ManifestArtifact[] {
  return files
    .map((file) => ({ path: file.path, sha256: sha256(file.bytes), bytes: file.bytes.length }))
    .sort((a, b) => byteCompare(a.path, b.path));
}

async function main(): Promise<void> {
  const releaseId = arg('release');
  const channel = arg('channel');
  const territoriesFile = arg('territories');
  const epochRaw = process.env.SOURCE_DATE_EPOCH;

  if (!releaseId) throw new Error('--release is required');
  if (channel !== 'internal' && channel !== 'public') {
    throw new Error('--channel must be internal or public');
  }
  if (!territoriesFile) throw new Error('--territories is required');
  if (!epochRaw || !/^\d+$/.test(epochRaw)) {
    throw new Error(
      'SOURCE_DATE_EPOCH must be set to a Unix timestamp. Without it the package cannot be ' +
        'reproduced, which is the only reason to build it deterministically at all.',
    );
  }
  const sourceDateEpoch = Number(epochRaw);

  // Step 2 before anything else touches the filesystem.
  const smoke = smokeTestSqlite();
  console.log(`better-sqlite3 loaded (SQLite ${smoke.sqliteVersion}, Node ${process.version})`);

  // Step 1: the audit gates the directory.
  const { runReleaseAuditForExport } = await import('../../src/dsd-corpus/release/gather');
  const audit = await runReleaseAuditForExport({ releaseId, channel, territoriesFile });
  if (audit.verdict !== 'GO') {
    console.error(`Release audit returned ${audit.verdict}; refusing to export.`);
    for (const blocker of audit.blockers.slice(0, 20)) {
      console.error(`  - ${blocker.code}: ${blocker.detail}`);
    }
    process.exit(1);
  }
  const record = audit.record!;

  // Step 4: a new directory or nothing.
  const outputDir = path.resolve(process.cwd(), OUTPUT_ROOT, releaseId);
  if (fs.existsSync(outputDir)) {
    throw new Error(
      `${outputDir} already exists. An export never overwrites: compare the existing package ` +
        'against its manifest, or remove it deliberately.',
    );
  }

  const config = buildDsdCorpusConfig();
  const ds = createDsdDataSource('audit', config);
  await ds.initialize();

  let rows: Record<string, any[]>;
  try {
    // Step 3: one repeatable-read, read-only snapshot for every row.
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      rows = {
        entries: await runner.query(Q.entries),
        senses: await runner.query(Q.senses),
        translations: await runner.query(Q.translations),
        examples: await runner.query(Q.examples),
        pronunciations: await runner.query(Q.pronunciations),
        relations: await runner.query(Q.relations),
        audio: await runner.query(Q.audio),
        provenance: await runner.query(Q.provenance),
        migration: await runner.query(Q.migration),
      };
      await runner.query('COMMIT');
    } catch (error) {
      await runner.query('ROLLBACK');
      throw error;
    } finally {
      await runner.release();
    }
  } finally {
    await ds.destroy();
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const files: WrittenFile[] = [];
  const write = (relative: string, bytes: Buffer) => {
    const target = path.join(outputDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    files.push({ path: relative, bytes });
  };

  // ── CSV artifacts ─────────────────────────────────────────────────────────
  const csvTables: Record<string, { columns: readonly string[]; rows: Array<Array<string | number | null>> }> = {};

  const emit = (
    relative: string,
    tableName: string,
    columns: readonly string[],
    source: any[],
    project: (row: any) => Array<string | number | null>,
  ) => {
    const projected = source.map(project);
    write(relative, csvBytes([...columns], projected));
    csvTables[tableName] = { columns, rows: projected };
  };

  emit('01_entries.csv', 'entries', CSV_SCHEMA.entries, rows.entries, (row) => [
    row.entry_id, row.headword, row.headword_normalized, row.language, row.dsd_band ?? '',
  ]);
  emit('02_senses.csv', 'senses', CSV_SCHEMA.senses, rows.senses, (row) => [
    row.sense_id, row.entry_id, row.sense_order, row.part_of_speech, row.definition_en,
    (row.usage_labels ?? []).join('|'),
  ]);
  emit('03_translations.csv', 'translations', CSV_SCHEMA.translations, rows.translations, (row) => [
    row.translation_id, row.sense_id, row.locale, row.text,
  ]);
  emit('04_examples.csv', 'examples', CSV_SCHEMA.examples, rows.examples, (row) => [
    row.example_id, row.sense_id, row.example_order, row.example_en, row.example_vi,
  ]);
  emit('05_pronunciations.csv', 'pronunciations', CSV_SCHEMA.pronunciations, rows.pronunciations, (row) => [
    row.pronunciation_id, row.entry_id, row.accent, row.ipa, row.priority,
  ]);
  emit('06_relations.csv', 'relations', CSV_SCHEMA.relations, rows.relations, (row) => [
    row.relation_id, row.sense_id, row.related_sense_id, row.relation_type,
  ]);
  emit('07_audio-manifest.csv', 'audio', CSV_SCHEMA.audio, rows.audio, (row) => [
    row.asset_id, row.entry_id, row.pronunciation_id, row.voice, row.format, row.media_type,
    row.duration_ms, row.sample_rate, row.sha256,
    `audio/${row.voice}/${row.sha256}.${row.format}`,
  ]);

  // ── provenance, pseudonymised ─────────────────────────────────────────────
  write(
    'PROVENANCE.jsonl',
    jsonlBytes(
      rows.provenance.map((event) => ({
        entity_kind: event.entity_kind,
        entity_id: event.entity_id,
        event_type: event.event_type,
        // Release-scoped, so two packages cannot be correlated, and stable
        // within this one, so author ≠ reviewer remains provable.
        actor_ref: actorRef(releaseId, event.actor),
        output_hash: event.output_hash ?? '',
        occurred_on: occurredOn(event.occurred_at),
      })),
    ),
  );

  // ── registries, with internal fields stripped ─────────────────────────────
  const sourceRegistry = readJsonIfPresent('data/dsd/source-registry.json') ?? { sources: [] };
  const toolRegistry = readJsonIfPresent('data/dsd/tool-registry.json') ?? { tools: [] };
  write(
    'SOURCE-REGISTRY.json',
    canonicalJsonBytes({
      sources: (sourceRegistry.sources ?? [])
        .filter((source: any) => source.status === 'approved')
        .map((source: any) => ({
          id: source.id,
          scopes: source.approvedScopes ?? [],
          url: source.url ?? '',
        })),
    }),
  );
  write(
    'TOOL-REGISTRY.json',
    canonicalJsonBytes({
      tools: (toolRegistry.tools ?? [])
        .filter((tool: any) => tool.status === 'approved')
        .map((tool: any) => ({
          id: tool.id,
          revision: tool.revision ?? '',
          license: tool.license ?? '',
          url: tool.url ?? '',
        })),
    }),
  );

  // ── documents ─────────────────────────────────────────────────────────────
  for (const [relative, template] of [
    ['DATA-PROVENANCE.md', 'data/dsd/release-docs/DATA-PROVENANCE.md'],
    ['THIRD-PARTY-NOTICES.md', 'data/dsd/release-docs/THIRD-PARTY-NOTICES.md'],
    ['DATA-LICENSE.md', 'data/dsd/release-docs/DATA-LICENSE.md'],
  ] as Array<[string, string]>) {
    const source = path.resolve(process.cwd(), template);
    if (!fs.existsSync(source)) {
      throw new Error(
        `${relative} has no reviewed source at ${template}. These documents state what a ` +
          'customer may do with the data; generating one from a code template would be ' +
          'inventing legal terms.',
      );
    }
    write(relative, fs.readFileSync(source));
  }

  // ── public key ────────────────────────────────────────────────────────────
  const keyRegistry = readJsonIfPresent('data/dsd/release-public-keys.json') ?? { keys: [] };
  const signerKeyId = arg('signer') ?? process.env.DSD_RELEASE_SIGNER_KEY_ID ?? '';
  const signerEntry = (keyRegistry.keys ?? []).find((key: any) => key.keyId === signerKeyId);
  if (!signerEntry) {
    throw new Error(
      `signer key '${signerKeyId}' is not in data/dsd/release-public-keys.json. That file is ` +
        'the trust root for offline verification; a package signed by a key it does not list ' +
        'cannot be verified by anyone.',
    );
  }
  if (signerEntry.status !== 'active') {
    throw new Error(`signer key '${signerKeyId}' is ${signerEntry.status}`);
  }
  write('RELEASE-PUBLIC-KEY.pem', Buffer.from(signerEntry.publicKeyPem, 'utf8'));

  // ── SQLite ────────────────────────────────────────────────────────────────
  const sqlitePath = path.join(outputDir, 'dsd-corpus.sqlite');
  buildSqlite(sqlitePath, csvTables);
  files.push({ path: 'dsd-corpus.sqlite', bytes: fs.readFileSync(sqlitePath) });

  // ── audio, verified while streaming ───────────────────────────────────────
  const audioArtifacts: ManifestArtifact[] = [];
  const { AwsCliObjectStore } = await import('./lib/object-store');
  const { parseS3Uri } = await import('./lib/object-store');
  const audioUri = process.env.DSD_AUDIO_S3_URI ?? '';
  const parsedUri = parseS3Uri(audioUri);

  if (rows.audio.length > 0) {
    if (!parsedUri) {
      throw new Error(
        'DSD_AUDIO_S3_URI must be configured to export audio; the manifest references ' +
          `${rows.audio.length} asset(s).`,
      );
    }
    const store = new AwsCliObjectStore({
      bucket: parsedUri.bucket,
      prefix: parsedUri.prefix,
      region: process.env.DSD_AUDIO_S3_REGION ?? 'us-east-1',
      endpoint: process.env.DSD_AUDIO_S3_ENDPOINT,
    });

    for (const asset of rows.audio) {
      const relative = `audio/${asset.voice}/${asset.sha256}.${asset.format}`;
      const bytes = await store.get(asset.storage_key);
      if (!bytes) {
        throw new Error(`audio object ${asset.storage_key} is missing from the object store`);
      }
      const actual = sha256(bytes);
      if (actual !== asset.sha256) {
        // Verified while copying, so a corrupt object fails the export rather
        // than shipping inside a signed package.
        throw new Error(
          `audio object ${asset.storage_key} hashes ${actual.slice(0, 12)}…, database says ` +
            `${String(asset.sha256).slice(0, 12)}…`,
        );
      }
      const target = path.join(outputDir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
      audioArtifacts.push({ path: relative, sha256: actual, bytes: bytes.length });
    }
  }

  // ── manifest, signature, checksums ────────────────────────────────────────
  const manifest = buildManifest({
    releaseId,
    channel,
    publicEligible: channel === 'public',
    sourceDateEpoch,
    auditVersion: record.auditVersion,
    signerKeyId,
    source: {
      database: record.databaseSnapshot.database,
      migration: rows.migration[0]?.version ?? '',
      similarityPolicySha256: record.similarityPolicy.sha256,
      sourceRegistrySha256: record.registryDigests.source,
      toolRegistrySha256: record.registryDigests.tool,
      contributorRegistrySha256: record.registryDigests.contributor,
    },
    counts: {
      entries: rows.entries.length,
      senses: rows.senses.length,
      translations: rows.translations.length,
      examples: rows.examples.length,
      relations: rows.relations.length,
      audioAssets: rows.audio.length,
    },
    territories: record.territories,
    artifacts: describeArtifacts(files),
    audio: audioArtifacts,
  });

  const manifestBytes = canonicalJsonBytes(manifest);
  fs.writeFileSync(path.join(outputDir, '00_manifest.json'), manifestBytes);

  const privateKeyPem = process.env.DSD_RELEASE_SIGNING_KEY_PEM;
  if (!privateKeyPem) {
    throw new Error(
      'DSD_RELEASE_SIGNING_KEY_PEM is not set. The private key lives in the release secret ' +
        'store, never in this repository and never in a package.',
    );
  }
  const signature = signManifestBytes(manifestBytes, privateKeyPem);
  fs.writeFileSync(path.join(outputDir, '00_manifest.sig'), `${signature}\n`);
  fs.writeFileSync(path.join(outputDir, 'checksums.sha256'), checksumsBytes(manifest));

  // ── step 6: verify what was just built ────────────────────────────────────
  const presentFiles: Record<string, { sha256: string; bytes: number }> = {};
  for (const artifact of [...manifest.artifacts, ...manifest.audio]) {
    const bytes = fs.readFileSync(path.join(outputDir, artifact.path));
    presentFiles[artifact.path] = { sha256: sha256(bytes), bytes: bytes.length };
  }
  const problems = verifyRelease({
    manifestBytes,
    signatureBase64: signature,
    trustedKeys: keyRegistry.keys,
    bundledKeyPem: signerEntry.publicKeyPem,
    presentFiles,
    checksumsBytes: checksumsBytes(manifest),
    now: new Date().toISOString(),
  });
  if (problems.length > 0) {
    console.error('The package did not verify after building:');
    for (const problem of problems) console.error(`  - ${problem.code}: ${problem.detail}`);
    process.exit(1);
  }

  console.log(`\nWrote ${outputDir}`);
  console.log(`  manifest  ${sha256(manifestBytes)}`);
  console.log(`  signer    ${signerKeyId}`);
  console.log(`  content   ${manifest.counts.entries} entries, ${manifest.counts.senses} senses`);
  console.log(`  audio     ${audioArtifacts.length} file(s)`);
  console.log('\nVerified. Recording the build.');

  // ── record the build, in a separate short write transaction ───────────────
  const writeDs = createDsdDataSource('curator', config);
  await writeDs.initialize();
  try {
    await writeDs.query(
      `INSERT INTO dsd_release_builds
         (release_id, channel, public_eligible, manifest_sha256, signature, signer_key_id,
          source_database, source_migration, source_date_epoch, similarity_policy_sha256,
          source_registry_sha256, tool_registry_sha256, contributor_registry_sha256,
          audit_version, entry_count, sense_count, audio_asset_count, territories, built_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT ON CONSTRAINT "UQ_dsd_release_build" DO NOTHING`,
      [
        releaseId, channel, channel === 'public', sha256(manifestBytes), signature, signerKeyId,
        manifest.source.database, manifest.source.migration, sourceDateEpoch,
        manifest.source.similarityPolicySha256, manifest.source.sourceRegistrySha256,
        manifest.source.toolRegistrySha256, manifest.source.contributorRegistrySha256,
        manifest.audit_version, manifest.counts.entries, manifest.counts.senses,
        manifest.counts.audioAssets, manifest.territories,
        arg('actor') ?? process.env.DSD_RELEASE_BUILT_BY ?? 'unknown',
      ],
    );
  } finally {
    await writeDs.destroy();
  }

  console.log('Build recorded.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
