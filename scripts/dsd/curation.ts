/**
 * DSD curation package tool.
 *
 * A curation package is how authored content enters the corpus: definitions,
 * Vietnamese translations and examples, written by a named contributor against
 * an inventory entry that already exists.
 *
 * Three properties matter more than convenience here:
 *
 *   1. The validator touches no database. Authors and reviewers run it on a
 *      laptop against a JSON file, so a package can be checked before anyone
 *      has credentials to anything.
 *   2. The importer writes drafts and nothing else. It has no code path that
 *      sets a reviewer, an approval or a publication status — those come from
 *      the review workflow, by a different person, under a CHECK constraint
 *      that refuses self-review.
 *   3. Content is hashed on the way in, onto the row and into the provenance
 *      ledger. The hash is what later binds an approval to the exact words a
 *      reviewer read.
 *
 * IPA, audio, similarity scores and any external provider or model field are
 * refused by name. Pronunciation is a separate workflow with a separate rights
 * basis, and DSD v1 admits no machine-generated content at all.
 *
 * USAGE:
 *   npm run dsd:curation:validate -- --file data/dsd/curation/batch-001.json
 *   npm run dsd:curation:import   -- --file data/dsd/curation/batch-001.json
 *   npm run dsd:curation:import   -- --file data/dsd/curation/batch-001.json --write
 *   npm run dsd:curation:stats
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { buildDsdCorpusConfig } from '../../src/dsd-corpus/dsd-corpus.config';
import { createDsdDataSource } from '../../src/dsd-corpus/dsd-corpus.datasource';
import { loadRegistries, RegistrySnapshot, snapshotRegistries } from './lib/registry';
import {
  normalizeContent,
  definitionHash,
  translationHash,
  exampleHash,
} from './lib/content-hash';

dotenv.config();

/**
 * Fields refused by name anywhere in a package.
 *
 * Unknown fields are rejected too, but these get a specific message because
 * each one represents a rule someone is about to break by accident: pasting a
 * legacy identifier, smuggling in pronunciation, self-approving, or running the
 * text through a model.
 */
export const FORBIDDEN_PACKAGE_FIELDS = [
  // Legacy identity. DSD rows reference DSD rows and nothing else.
  'word_id',
  'definition_id',
  'source_definition_id',
  'source_sense_id',
  'example_id',
  'legacy_id',
  'oewn_sense_id',
  'ngsl_rank',
  'frequency_rank',
  // Separate workflows with a separate rights basis.
  'ipa',
  'pronunciation',
  'audio_url',
  'audio_path',
  // Review and publication state. Curation produces drafts; a package that
  // could carry these would be a package that could approve its own content.
  'status',
  'reviewed_by',
  'reviewed_at',
  'approved_by',
  'approved_at',
  'published_at',
  'revision',
  'supersedes_id',
  // No machine-generated content in DSD v1, and no third-party transfer.
  'provider',
  'model',
  'prompt',
  'temperature',
  'api_key',
  'generated_by',
  // Similarity is measured by the audit, never asserted by the author.
  'similarity_score',
  'similarity_source',
] as const;

const PACKAGE_KEYS = ['$schema', 'package_version', 'batch_id', 'declaration_id', 'entries'];
/** headword and product_rationale are authoring context: checked, never written. */
const ENTRY_KEYS = ['dsd_entry_id', 'headword', 'product_rationale', 'senses'];
const SENSE_KEYS = [
  'sense_key', 'sense_order', 'part_of_speech', 'definition_en', 'usage_labels',
  'authored_by', 'source_id', 'rights_evidence_id', 'translation', 'examples',
];
const TRANSLATION_KEYS = ['locale', 'text', 'authored_by', 'source_id', 'rights_evidence_id'];
const EXAMPLE_KEYS = [
  'example_order', 'en', 'vi', 'authored_by', 'source_id', 'rights_evidence_id',
];

const PART_OF_SPEECH = [
  'noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition',
  'conjunction', 'interjection', 'determiner', 'numeral', 'phrase',
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER_UUID = '00000000-0000-0000-0000-000000000000';
const MAX_DEFINITION_LENGTH = 400;

export interface CurationTranslation {
  locale: string;
  text: string;
  authored_by: string;
  source_id: string;
  rights_evidence_id: string;
}

export interface CurationExample {
  example_order: number;
  en: string;
  vi: string;
  authored_by: string;
  source_id: string;
  rights_evidence_id: string;
}

export interface CurationSense {
  sense_key: string;
  sense_order: number;
  part_of_speech: string;
  definition_en: string;
  usage_labels: string[];
  authored_by: string;
  source_id: string;
  rights_evidence_id: string;
  translation?: CurationTranslation;
  examples: CurationExample[];
}

export interface CurationEntry {
  dsd_entry_id: string;
  headword?: string;
  product_rationale?: string;
  senses: CurationSense[];
}

export interface CurationPackage {
  package_version: number;
  batch_id: string;
  declaration_id: string;
  entries: CurationEntry[];
}

// ─── validation ─────────────────────────────────────────────────────────────

function checkKeys(
  value: unknown,
  allowed: string[],
  where: string,
  errors: string[],
): void {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if ((FORBIDDEN_PACKAGE_FIELDS as readonly string[]).includes(key)) {
      errors.push(
        `${where}: forbidden field '${key}' — curation packages carry authored ` +
          'definitions, translations and examples only',
      );
    } else if (!allowed.includes(key)) {
      // Never ignore an unrecognised field: that is how content of unknown
      // provenance arrives without anyone deciding to admit it.
      errors.push(`${where}: unknown field '${key}'`);
    }
  }
}

/** A source is usable only if it is approved for the scope of this record. */
function checkSource(
  sourceId: string,
  scope: 'definition' | 'translation' | 'example',
  where: string,
  registry: RegistrySnapshot,
  errors: string[],
): void {
  const scopes = registry.approvedScopesBySource[(sourceId ?? '').trim()];
  if (!scopes || !scopes.includes(scope)) {
    errors.push(
      `${where}: source '${sourceId}' is not approved for scope '${scope}'`,
    );
  }
}

/**
 * Every record names its own author and its own rights evidence, and both must
 * agree with the registry. A package asserting evidence the registry does not
 * record is the shape a forged authorship claim takes.
 */
function checkContributor(
  contributorId: string,
  evidenceId: string,
  where: string,
  registry: RegistrySnapshot,
  errors: string[],
): void {
  const id = (contributorId ?? '').trim();
  const contributor = registry.contributors[id];

  if (!contributor) {
    errors.push(`${where}: contributor '${contributorId}' is not in the contributor registry`);
    return;
  }

  if (contributor.status !== 'active') {
    errors.push(`${where}: contributor '${id}' is not active (status '${contributor.status}')`);
  }

  if (!contributor.roles.includes('author')) {
    errors.push(`${where}: contributor '${id}' does not hold the author role`);
  }

  if (!contributor.rightsEvidenceId) {
    errors.push(`${where}: contributor '${id}' has no rights evidence recorded`);
    return;
  }

  if ((evidenceId ?? '').trim() !== contributor.rightsEvidenceId) {
    errors.push(
      `${where}: rights evidence '${evidenceId}' for contributor '${id}' ` +
        'does not match the registry',
    );
  }
}

function validateTranslation(
  translation: CurationTranslation,
  where: string,
  registry: RegistrySnapshot,
  errors: string[],
): void {
  checkKeys(translation, TRANSLATION_KEYS, where, errors);

  if (translation.locale !== 'vi') {
    errors.push(`${where}: locale must be 'vi', got '${translation.locale}'`);
  }
  if (!normalizeContent(translation.text ?? '')) {
    errors.push(`${where}: translation text is empty`);
  }

  checkSource(translation.source_id, 'translation', where, registry, errors);
  checkContributor(
    translation.authored_by, translation.rights_evidence_id, where, registry, errors,
  );
}

function validateExample(
  example: CurationExample,
  where: string,
  registry: RegistrySnapshot,
  errors: string[],
): void {
  checkKeys(example, EXAMPLE_KEYS, where, errors);

  if (!Number.isInteger(example.example_order) || example.example_order <= 0) {
    errors.push(`${where}: example_order must be a positive integer`);
  }
  if (!normalizeContent(example.en ?? '')) errors.push(`${where}: English example is empty`);
  if (!normalizeContent(example.vi ?? '')) errors.push(`${where}: Vietnamese example is empty`);

  checkSource(example.source_id, 'example', where, registry, errors);
  checkContributor(example.authored_by, example.rights_evidence_id, where, registry, errors);
}

function validateSense(
  sense: CurationSense,
  where: string,
  registry: RegistrySnapshot,
  errors: string[],
): void {
  checkKeys(sense, SENSE_KEYS, where, errors);

  if (!(sense.sense_key ?? '').trim()) errors.push(`${where}: sense_key is required`);
  if (!Number.isInteger(sense.sense_order) || sense.sense_order <= 0) {
    errors.push(`${where}: sense_order must be a positive integer`);
  }
  if (!PART_OF_SPEECH.includes(sense.part_of_speech)) {
    errors.push(`${where}: unknown part of speech '${sense.part_of_speech}'`);
  }

  const definition = normalizeContent(sense.definition_en ?? '');
  if (!definition) {
    errors.push(`${where}: definition_en is empty`);
  } else if (definition.length > MAX_DEFINITION_LENGTH) {
    errors.push(`${where}: definition_en is ${definition.length} chars — split the sense`);
  }

  if (!Array.isArray(sense.usage_labels)) {
    errors.push(`${where}: usage_labels must be an array`);
  }

  checkSource(sense.source_id, 'definition', where, registry, errors);
  checkContributor(sense.authored_by, sense.rights_evidence_id, where, registry, errors);

  if (!sense.translation) {
    errors.push(`${where}: a Vietnamese translation is required`);
  } else {
    validateTranslation(sense.translation, `${where} translation`, registry, errors);
  }

  const examples = Array.isArray(sense.examples) ? sense.examples : [];
  if (examples.length === 0) {
    errors.push(`${where}: at least one example is required`);
  }

  const orders = new Set<number>();
  examples.forEach((example, index) => {
    validateExample(example, `${where} example ${index + 1}`, registry, errors);
    if (orders.has(example?.example_order)) {
      errors.push(`${where}: duplicate example_order ${example.example_order}`);
    }
    orders.add(example?.example_order);
  });
}

export function validatePackage(pkg: CurationPackage, registry: RegistrySnapshot): string[] {
  const errors: string[] = [];
  checkKeys(pkg, PACKAGE_KEYS, 'package', errors);

  if (pkg.package_version !== 1) {
    errors.push(`package: package_version must be 1, got '${pkg.package_version}'`);
  }
  if (!(pkg.batch_id ?? '').trim()) errors.push('package: batch_id is required');
  if (!(pkg.declaration_id ?? '').trim()) {
    errors.push(
      'package: declaration_id is required — every batch needs a signed clean-room declaration',
    );
  }

  const entries = Array.isArray(pkg.entries) ? pkg.entries : [];
  if (entries.length === 0) errors.push('package: entries is empty');

  const seenEntries = new Set<string>();
  entries.forEach((entry, entryIndex) => {
    const where = `entry ${entryIndex + 1}`;
    checkKeys(entry, ENTRY_KEYS, where, errors);

    const id = (entry.dsd_entry_id ?? '').trim();
    if (!UUID_RE.test(id)) {
      // Content is attached to an inventory entry that already exists. A
      // headword here would mean the author invented the entry.
      errors.push(`${where}: dsd_entry_id '${entry.dsd_entry_id}' is not a DSD entry UUID`);
    } else if (id === PLACEHOLDER_UUID) {
      errors.push(`${where}: dsd_entry_id is still the blank-template placeholder`);
    } else if (seenEntries.has(id.toLowerCase())) {
      errors.push(`${where}: dsd_entry_id ${id} appears twice in this package`);
    }
    seenEntries.add(id.toLowerCase());

    const senses = Array.isArray(entry.senses) ? entry.senses : [];
    if (senses.length === 0) {
      errors.push(`${where}: must have at least one sense`);
    }

    const keys = new Set<string>();
    const orders = new Set<number>();
    senses.forEach((sense, senseIndex) => {
      validateSense(sense, `${where} sense ${senseIndex + 1}`, registry, errors);
      if (keys.has(sense?.sense_key)) {
        errors.push(`${where}: duplicate sense_key '${sense.sense_key}'`);
      }
      if (orders.has(sense?.sense_order)) {
        errors.push(`${where}: duplicate sense_order ${sense.sense_order}`);
      }
      keys.add(sense?.sense_key);
      orders.add(sense?.sense_order);
    });
  });

  return errors;
}

// ─── planning ───────────────────────────────────────────────────────────────

/**
 * The planned row types deliberately have no reviewer or publication field.
 * The importer cannot set what it cannot represent.
 */
export interface PlannedSense {
  dsdEntryId: string;
  senseKey: string;
  senseOrder: number;
  partOfSpeech: string;
  definitionEn: string;
  usageLabels: string[];
  authoredBy: string;
  sourceId: string;
  rightsEvidenceId: string;
  contentSha256: string;
  status: 'draft';
}

export interface PlannedTranslation {
  dsdEntryId: string;
  senseKey: string;
  locale: string;
  text: string;
  textNormalized: string;
  authoredBy: string;
  sourceId: string;
  rightsEvidenceId: string;
  contentSha256: string;
  status: 'draft';
}

export interface PlannedExample {
  dsdEntryId: string;
  senseKey: string;
  exampleOrder: number;
  exampleEn: string;
  exampleVi: string;
  authoredBy: string;
  sourceId: string;
  rightsEvidenceId: string;
  contentSha256: string;
  status: 'draft';
}

export interface CurationPlan {
  batchId: string;
  declarationId: string;
  senses: PlannedSense[];
  translations: PlannedTranslation[];
  examples: PlannedExample[];
}

export function planCurationImport(pkg: CurationPackage): CurationPlan {
  const plan: CurationPlan = {
    batchId: pkg.batch_id,
    declarationId: pkg.declaration_id,
    senses: [],
    translations: [],
    examples: [],
  };

  for (const entry of pkg.entries ?? []) {
    const dsdEntryId = entry.dsd_entry_id;

    for (const sense of entry.senses ?? []) {
      const definitionEn = normalizeContent(sense.definition_en);
      const usageLabels = [...(sense.usage_labels ?? [])].map(normalizeContent).sort();

      plan.senses.push({
        dsdEntryId,
        senseKey: sense.sense_key,
        senseOrder: sense.sense_order,
        partOfSpeech: sense.part_of_speech,
        definitionEn,
        usageLabels,
        authoredBy: sense.authored_by,
        sourceId: sense.source_id,
        rightsEvidenceId: sense.rights_evidence_id,
        contentSha256: definitionHash({
          definitionEn,
          partOfSpeech: sense.part_of_speech,
          usageLabels,
        }),
        status: 'draft',
      });

      if (sense.translation) {
        const text = normalizeContent(sense.translation.text);
        plan.translations.push({
          dsdEntryId,
          senseKey: sense.sense_key,
          locale: sense.translation.locale,
          text,
          textNormalized: text.toLowerCase(),
          authoredBy: sense.translation.authored_by,
          sourceId: sense.translation.source_id,
          rightsEvidenceId: sense.translation.rights_evidence_id,
          contentSha256: translationHash({ locale: sense.translation.locale, text }),
          status: 'draft',
        });
      }

      for (const example of sense.examples ?? []) {
        const exampleEn = normalizeContent(example.en);
        const exampleVi = normalizeContent(example.vi);
        plan.examples.push({
          dsdEntryId,
          senseKey: sense.sense_key,
          exampleOrder: example.example_order,
          exampleEn,
          exampleVi,
          authoredBy: example.authored_by,
          sourceId: example.source_id,
          rightsEvidenceId: example.rights_evidence_id,
          contentSha256: exampleHash({ exampleEn, exampleVi }),
          status: 'draft',
        });
      }
    }
  }

  return plan;
}

// ─── I/O ────────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readPackage(file: string): CurationPackage {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function reportErrors(errors: string[], file: string): void {
  console.error(`${errors.length} validation error(s) in ${file}:`);
  for (const error of errors.slice(0, 40)) console.error(`  - ${error}`);
  if (errors.length > 40) console.error(`  … ${errors.length - 40} more`);
}

/** Validate a package file. Reads registries from Git; opens no connection. */
function validateFile(file: string): CurationPackage {
  const loaded = loadRegistries();
  if (loaded.errors.length > 0) {
    console.error('Registry validation failed; fix the registries first:');
    for (const error of loaded.errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  const pkg = readPackage(file);
  const errors = validatePackage(pkg, snapshotRegistries(loaded));
  if (errors.length > 0) {
    reportErrors(errors, file);
    process.exit(1);
  }
  return pkg;
}

/**
 * Write a provenance event for one content row. event_type is always 'imported'
 * and output_hash is the content hash, so the ledger can be checked against the
 * rows without trusting either alone.
 */
async function recordImport(
  manager: { query: (sql: string, params: unknown[]) => Promise<unknown> },
  kind: 'sense' | 'translation' | 'example',
  entityId: string,
  row: { authoredBy: string; sourceId: string; contentSha256: string },
  declarationId: string,
): Promise<void> {
  await manager.query(
    `INSERT INTO dsd_provenance_events
       (entity_kind, entity_id, event_type, actor, source_id, output_hash, evidence_id)
     VALUES ($1,$2,'imported',$3,$4,$5,$6)`,
    [kind, entityId, row.authoredBy, row.sourceId, row.contentSha256, declarationId],
  );
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!['validate', 'import', 'stats'].includes(command)) {
    throw new Error('Usage: curation.ts <validate|import|stats> [--file <json>] [--write]');
  }

  if (command === 'validate') {
    const file = arg('file');
    if (!file) throw new Error('--file is required');
    const pkg = validateFile(path.resolve(process.cwd(), file));
    const plan = planCurationImport(pkg);
    console.log(
      `Valid. ${plan.senses.length} sense(s), ${plan.translations.length} translation(s), ` +
        `${plan.examples.length} example(s) in batch ${plan.batchId}.`,
    );
    return;
  }

  const config = buildDsdCorpusConfig();
  if (config.errors.length > 0) {
    throw new Error('DSD configuration invalid:\n  - ' + config.errors.join('\n  - '));
  }

  if (command === 'stats') {
    const ds = createDsdDataSource('curator', config);
    await ds.initialize();
    try {
      for (const table of ['dsd_senses', 'dsd_translations', 'dsd_examples']) {
        const rows = await ds.query(
          `SELECT status, count(*)::int AS n FROM ${table} GROUP BY status ORDER BY status`,
        );
        const total = rows.reduce((sum: number, r: any) => sum + r.n, 0);
        console.log(`${table}: ${total}`);
        for (const r of rows) console.log(`  ${String(r.status).padEnd(10)} ${r.n}`);
      }
    } finally {
      await ds.destroy();
    }
    return;
  }

  const file = arg('file');
  if (!file) throw new Error('--file is required');
  const pkg = validateFile(path.resolve(process.cwd(), file));
  const plan = planCurationImport(pkg);
  const write = process.argv.includes('--write');

  const ds = createDsdDataSource('curator', config);
  await ds.initialize();
  try {
    const entryIds = [...new Set(plan.senses.map((s) => s.dsdEntryId))];
    const entries: Array<{ id: string; headword: string }> = await ds.query(
      `SELECT id, headword FROM dsd_entries WHERE id = ANY($1::uuid[])`,
      [entryIds],
    );
    const byId = new Map(entries.map((e) => [e.id, e]));

    const rejected: string[] = [];
    for (const entry of pkg.entries) {
      const existing = byId.get(entry.dsd_entry_id);
      if (!existing) {
        rejected.push(
          `entry ${entry.dsd_entry_id} is not in the inventory — import it there first`,
        );
        continue;
      }
      // The headword in the package is context, not data. Comparing it catches
      // senses authored against the wrong UUID, which nothing else would.
      if (entry.headword && normalizeContent(entry.headword) !== existing.headword) {
        rejected.push(
          `entry ${entry.dsd_entry_id}: package says '${entry.headword}', ` +
            `inventory says '${existing.headword}'`,
        );
      }
    }

    const present: Array<{ dsdEntryId: string; senseKey: string; sha: string; status: string }> =
      await ds.query(
        `SELECT dsd_entry_id AS "dsdEntryId", sense_key AS "senseKey",
                content_sha256 AS sha, status
           FROM dsd_senses WHERE dsd_entry_id = ANY($1::uuid[])`,
        [entryIds],
      );
    const presentByKey = new Map(present.map((p) => [`${p.dsdEntryId} ${p.senseKey}`, p]));

    const toInsert: PlannedSense[] = [];
    let unchanged = 0;
    for (const sense of plan.senses) {
      const current = presentByKey.get(`${sense.dsdEntryId} ${sense.senseKey}`);
      if (!current) {
        toInsert.push(sense);
      } else if (current.sha === sense.contentSha256) {
        // Re-running the same file is a no-op, whatever the row's status.
        unchanged++;
      } else {
        rejected.push(
          `sense '${sense.senseKey}' on entry ${sense.dsdEntryId} already exists with ` +
            'different content; corrections are new revisions, not re-imports',
        );
      }
    }

    console.log(`  insert    ${toInsert.length} sense(s) with their translations and examples`);
    console.log(`  unchanged ${unchanged}`);
    console.log(`  rejected  ${rejected.length}`);
    for (const rejection of rejected) console.error(`  - ${rejection}`);

    if (rejected.length > 0) {
      console.error('Refusing to import while rejections stand.');
      process.exit(1);
    }

    if (!write) {
      console.log('\nDRY RUN — nothing written. Re-run with --write to apply.');
      return;
    }

    const insertKeys = new Set(toInsert.map((s) => `${s.dsdEntryId} ${s.senseKey}`));

    // One transaction: a batch lands completely or not at all.
    await ds.transaction(async (manager) => {
      const senseIds = new Map<string, string>();

      for (const sense of toInsert) {
        // status defaults to 'draft'; reviewed_by and reviewed_at are not in
        // the column list and cannot be reached from here.
        const [row] = await manager.query(
          `INSERT INTO dsd_senses
             (dsd_entry_id, sense_key, sense_order, part_of_speech, definition_en,
              usage_labels, authored_by, content_sha256, source_id, batch_id,
              rights_evidence_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [
            sense.dsdEntryId, sense.senseKey, sense.senseOrder, sense.partOfSpeech,
            sense.definitionEn, sense.usageLabels, sense.authoredBy, sense.contentSha256,
            sense.sourceId, plan.batchId, sense.rightsEvidenceId,
          ],
        );
        senseIds.set(`${sense.dsdEntryId} ${sense.senseKey}`, row.id);
        await recordImport(manager, 'sense', row.id, sense, plan.declarationId);
      }

      for (const translation of plan.translations) {
        const key = `${translation.dsdEntryId} ${translation.senseKey}`;
        if (!insertKeys.has(key)) continue;
        const [row] = await manager.query(
          `INSERT INTO dsd_translations
             (dsd_sense_id, locale, text, text_normalized, authored_by, content_sha256,
              source_id, batch_id, rights_evidence_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [
            senseIds.get(key), translation.locale, translation.text, translation.textNormalized,
            translation.authoredBy, translation.contentSha256, translation.sourceId,
            plan.batchId, translation.rightsEvidenceId,
          ],
        );
        await recordImport(manager, 'translation', row.id, translation, plan.declarationId);
      }

      for (const example of plan.examples) {
        const key = `${example.dsdEntryId} ${example.senseKey}`;
        if (!insertKeys.has(key)) continue;
        const [row] = await manager.query(
          `INSERT INTO dsd_examples
             (dsd_sense_id, example_order, example_en, example_vi, authored_by,
              content_sha256, source_id, batch_id, rights_evidence_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [
            senseIds.get(key), example.exampleOrder, example.exampleEn, example.exampleVi,
            example.authoredBy, example.contentSha256, example.sourceId, plan.batchId,
            example.rightsEvidenceId,
          ],
        );
        await recordImport(manager, 'example', row.id, example, plan.declarationId);
      }
    });

    console.log(`\nImported ${toInsert.length} sense(s) as drafts. Nothing is approved.`);
  } finally {
    await ds.destroy();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
