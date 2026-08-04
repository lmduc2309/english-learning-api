/**
 * Import and audit DSD-authored relations.
 *
 * A relation is a claim: "this sense means roughly the same as that one".
 * Someone asserts it and someone else checks it, exactly like a definition. What
 * this tool exists to prevent is the shortcut — pointing it at a WordNet or
 * Wiktionary relation set and importing tens of thousands of edges in an
 * afternoon. That would be quick, and it would put a borrowed licence back into
 * the corpus DSD was rebuilt to keep clean.
 *
 * So the refusals are:
 *
 *   - **A borrowed source.** Named in the schema as well as here, so editing
 *     this file is not enough.
 *   - **A sense that does not exist.** Both ends must resolve to DSD senses, and
 *     the importer checks before writing rather than relying on the foreign key
 *     to fail halfway through a batch.
 *   - **A self-relation**, and a duplicate of one already recorded.
 *   - **Its own review.** Import writes drafts. Approval is a separate act by a
 *     different person, and the database refuses a row that reviews itself.
 *
 * There is no CEFR anywhere in this file, and no frequency rank. `dsd_band` is a
 * product ordering value; a database CHECK refuses a band spelled like a CEFR
 * level, because labelling content A2 without a rubric behind it is a claim DSD
 * cannot support.
 *
 * USAGE:
 *   npm run dsd:relations:validate -- --file data/dsd/relations/batch-001.json
 *   npm run dsd:relations:import   -- --file data/dsd/relations/batch-001.json [--write]
 *   npm run dsd:relations:audit
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { buildDsdCorpusConfig } from '../../src/dsd-corpus/dsd-corpus.config';
import { createDsdDataSource } from '../../src/dsd-corpus/dsd-corpus.datasource';
import { RegistrySnapshot, loadRegistries, snapshotRegistries } from './lib/registry';
import { relationHash as hashRelation } from './lib/content-hash';

dotenv.config();

export const RELATION_TYPES = [
  'synonym',
  'antonym',
  'related',
  'derived_form',
  'see_also',
] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

/** Symmetric types are served both ways by the view; these are not. */
export const DIRECTIONAL_RELATION_TYPES: RelationType[] = ['derived_form'];

/**
 * Relation sets that must not be imported at any licence.
 *
 * Duplicated from the migration deliberately. The schema check is the one that
 * cannot be edited away; this one produces a readable error before anything
 * touches the database.
 */
export const BORROWED_SOURCES = [
  'oewn-2025',
  'wordnet',
  'wordnet-3.1',
  'open-english-wordnet',
  'wiktionary-en',
  'wiktionary',
  'legacy-dictionary-corpus',
  'tudien-archive',
];

const FORBIDDEN_FIELDS = [
  'status', 'reviewed_by', 'reviewed_at', 'content_sha256',
  'cefr', 'cefr_level', 'difficulty', 'frequency_rank',
  'word_id', 'definition_id', 'legacy_id', 'synonym_id', 'oewn_sense_id',
  'provider', 'model', 'prompt',
] as const;

const FILE_KEYS = ['$schema', 'relations_version', 'batch_id', 'declaration_id', 'relations'];
const RELATION_KEYS = [
  'from_sense_id', 'to_sense_id', 'relation_type', 'authored_by', 'source_id',
  'rights_evidence_id', 'rationale',
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RelationInput {
  from_sense_id: string;
  to_sense_id: string;
  relation_type: RelationType;
  authored_by: string;
  source_id: string;
  rights_evidence_id: string;
  /** Why the claim holds. Kept in the file, not in the database. */
  rationale: string;
}

export interface RelationsFile {
  relations_version: number;
  batch_id: string;
  declaration_id: string;
  relations: RelationInput[];
}

function checkKeys(value: unknown, allowed: string[], where: string, errors: string[]): void {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if ((FORBIDDEN_FIELDS as readonly string[]).includes(key)) {
      errors.push(
        `${where}: forbidden field '${key}' — an import states a claim and its authorship, ` +
          'never review state, a difficulty band, or a legacy identifier',
      );
    } else if (!allowed.includes(key)) {
      errors.push(`${where}: unknown field '${key}'`);
    }
  }
}

/** Pure. Validates the file alone; opens no connection. */
export function validateRelationsFile(
  doc: RelationsFile,
  registry: RegistrySnapshot,
): string[] {
  const errors: string[] = [];
  checkKeys(doc, FILE_KEYS, 'relations', errors);

  if (doc.relations_version !== 1) errors.push('relations: relations_version must be 1');
  if (!(doc.batch_id ?? '').trim()) errors.push('relations: batch_id is required');
  if (!(doc.declaration_id ?? '').trim()) {
    errors.push('relations: declaration_id is required — a batch names its clean-room declaration');
  }

  const relations = Array.isArray(doc.relations) ? doc.relations : [];
  if (relations.length === 0) errors.push('relations: no relations');

  const seen = new Set<string>();

  relations.forEach((relation, index) => {
    const where = `relation ${index + 1}`;
    checkKeys(relation, RELATION_KEYS, where, errors);

    for (const field of ['from_sense_id', 'to_sense_id'] as const) {
      if (!UUID_RE.test((relation[field] ?? '').trim())) {
        errors.push(`${where}: ${field} must be a DSD sense UUID`);
      }
    }
    if (relation.from_sense_id && relation.from_sense_id === relation.to_sense_id) {
      errors.push(`${where}: a sense is not related to itself`);
    }

    if (!(RELATION_TYPES as readonly string[]).includes(relation.relation_type)) {
      errors.push(
        `${where}: relation_type must be one of ${RELATION_TYPES.join(', ')}`,
      );
    }

    // Symmetric relations are served both ways, so recording both directions
    // would duplicate the claim and make one half retirable without the other.
    const key = DIRECTIONAL_RELATION_TYPES.includes(relation.relation_type)
      ? `${relation.from_sense_id}>${relation.to_sense_id}:${relation.relation_type}`
      : [relation.from_sense_id, relation.to_sense_id].sort().join('~') +
        `:${relation.relation_type}`;
    if (seen.has(key)) {
      errors.push(`${where}: duplicates an earlier relation in this file`);
    }
    seen.add(key);

    if (BORROWED_SOURCES.includes((relation.source_id ?? '').trim())) {
      errors.push(
        `${where}: source '${relation.source_id}' is a third-party relation set and is never ` +
          'imported; a DSD relation is authored, not copied',
      );
    } else {
      const approved = registry.approvedScopesBySource[(relation.source_id ?? '').trim()];
      if (!approved || !approved.includes('relation')) {
        errors.push(
          `${where}: source '${relation.source_id}' is not approved for scope 'relation'`,
        );
      }
    }

    const author = registry.contributors[(relation.authored_by ?? '').trim()];
    if (!author) {
      errors.push(`${where}: author '${relation.authored_by}' is not in the contributor registry`);
    } else {
      if (author.status !== 'active') {
        errors.push(`${where}: author '${relation.authored_by}' is not active`);
      }
      if (!author.roles.includes('author')) {
        errors.push(`${where}: '${relation.authored_by}' does not hold the author role`);
      }
      if (!author.rightsEvidenceId) {
        errors.push(`${where}: author '${relation.authored_by}' has no rights evidence`);
      } else if (author.rightsEvidenceId !== (relation.rights_evidence_id ?? '').trim()) {
        errors.push(
          `${where}: rights_evidence_id '${relation.rights_evidence_id}' does not match the ` +
            'registry',
        );
      }
    }

    if (!(relation.rationale ?? '').trim()) {
      errors.push(`${where}: rationale is required — a relation is a claim someone stands behind`);
    }
  });

  return errors;
}

export function relationHash(relation: {
  from_sense_id: string;
  to_sense_id: string;
  relation_type: string;
}): string {
  return hashRelation({
    fromSenseId: relation.from_sense_id,
    toSenseId: relation.to_sense_id,
    relationType: relation.relation_type,
  });
}

export interface RelationPlanRow {
  fromSenseId: string;
  toSenseId: string;
  relationType: string;
  authoredBy: string;
  sourceId: string;
  rightsEvidenceId: string;
  contentSha256: string;
  status: 'draft';
}

export interface RelationPlan {
  toInsert: RelationPlanRow[];
  blocked: string[];
}

export interface ExistingRelation {
  fromSenseId: string;
  toSenseId: string;
  relationType: string;
}

/**
 * Check each relation against the senses that exist.
 *
 * Both ends are verified before anything is written. The foreign key would catch
 * a missing sense too, but halfway through a transaction — and the useful output
 * is the whole list of problems, not the first one.
 */
export function planRelationImport(
  doc: RelationsFile,
  knownSenseIds: string[],
  existing: ExistingRelation[] = [],
): RelationPlan {
  const plan: RelationPlan = { toInsert: [], blocked: [] };
  const known = new Set(knownSenseIds);
  const already = new Set(
    existing.map((relation) =>
      DIRECTIONAL_RELATION_TYPES.includes(relation.relationType as RelationType)
        ? `${relation.fromSenseId}>${relation.toSenseId}:${relation.relationType}`
        : [relation.fromSenseId, relation.toSenseId].sort().join('~') + `:${relation.relationType}`,
    ),
  );

  for (const [index, relation] of (doc.relations ?? []).entries()) {
    const where = `relation ${index + 1}`;

    const missing = [relation.from_sense_id, relation.to_sense_id].filter((id) => !known.has(id));
    if (missing.length > 0) {
      plan.blocked.push(
        `${where}: ${missing.length} end(s) do not resolve to a DSD sense: ${missing.join(', ')}`,
      );
      continue;
    }

    const key = DIRECTIONAL_RELATION_TYPES.includes(relation.relation_type)
      ? `${relation.from_sense_id}>${relation.to_sense_id}:${relation.relation_type}`
      : [relation.from_sense_id, relation.to_sense_id].sort().join('~') +
        `:${relation.relation_type}`;
    if (already.has(key)) {
      plan.blocked.push(`${where}: this relation is already recorded`);
      continue;
    }
    already.add(key);

    plan.toInsert.push({
      fromSenseId: relation.from_sense_id,
      toSenseId: relation.to_sense_id,
      relationType: relation.relation_type,
      authoredBy: relation.authored_by,
      sourceId: relation.source_id,
      rightsEvidenceId: relation.rights_evidence_id,
      contentSha256: relationHash(relation),
      // Draft, always. Approval is a separate act by a different person.
      status: 'draft',
    });
  }

  return plan;
}

export interface RelationAuditRow {
  id: string;
  relationType: string;
  status: string;
  sourceId: string;
  authoredBy: string;
  reviewedBy: string | null;
  fromSenseExists: boolean;
  toSenseExists: boolean;
}

/** Findings a release must not carry. */
export function auditRelations(rows: RelationAuditRow[]): string[] {
  const findings: string[] = [];

  for (const row of rows) {
    if (!row.fromSenseExists || !row.toSenseExists) {
      // The foreign keys make this impossible; if it appears, something is wrong
      // deeper than this table.
      findings.push(`${row.id}: references a sense that does not exist`);
    }
    if (BORROWED_SOURCES.includes(row.sourceId)) {
      findings.push(`${row.id}: source '${row.sourceId}' is a borrowed relation set`);
    }
    if (['approved', 'published'].includes(row.status)) {
      if (!row.reviewedBy) {
        findings.push(`${row.id}: is '${row.status}' but names no reviewer`);
      } else if (row.reviewedBy === row.authoredBy) {
        findings.push(`${row.id}: was reviewed by its own author`);
      }
    }
    if (!(RELATION_TYPES as readonly string[]).includes(row.relationType)) {
      findings.push(`${row.id}: unknown relation type '${row.relationType}'`);
    }
  }

  return findings;
}

// ─── I/O ────────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const SENSES_SQL = `SELECT id FROM dsd_senses WHERE id = ANY($1::uuid[])`;

const EXISTING_SQL = `
  SELECT from_sense_id AS "fromSenseId", to_sense_id AS "toSenseId",
         relation_type AS "relationType"
    FROM dsd_relations
   WHERE from_sense_id = ANY($1::uuid[]) OR to_sense_id = ANY($1::uuid[])`;

const AUDIT_SQL = `
  SELECT r.id, r.relation_type AS "relationType", r.status,
         r.source_id AS "sourceId", r.authored_by AS "authoredBy",
         r.reviewed_by AS "reviewedBy",
         EXISTS (SELECT 1 FROM dsd_senses s WHERE s.id = r.from_sense_id) AS "fromSenseExists",
         EXISTS (SELECT 1 FROM dsd_senses s WHERE s.id = r.to_sense_id) AS "toSenseExists"
    FROM dsd_relations r
   ORDER BY r.created_at`;

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'validate';

  const loaded = loadRegistries();
  if (loaded.errors.length > 0) {
    throw new Error('Registry validation failed:\n  - ' + loaded.errors.join('\n  - '));
  }

  if (command === 'validate') {
    const file = arg('file');
    if (!file) throw new Error('--file is required');
    const doc: RelationsFile = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'),
    );
    const errors = validateRelationsFile(doc, snapshotRegistries(loaded));
    if (errors.length > 0) {
      console.error(`${errors.length} validation error(s) in ${file}:`);
      for (const error of errors.slice(0, 40)) console.error(`  - ${error}`);
      process.exit(1);
    }
    console.log(`${doc.relations.length} relation(s) valid. No database was consulted.`);
    return;
  }

  const config = buildDsdCorpusConfig();
  if (config.errors.length > 0) {
    throw new Error('DSD configuration invalid:\n  - ' + config.errors.join('\n  - '));
  }

  if (command === 'audit') {
    const ds = createDsdDataSource('audit', config);
    await ds.initialize();
    try {
      const rows: RelationAuditRow[] = await ds.query(AUDIT_SQL);
      const findings = auditRelations(rows);
      console.log(`${rows.length} relation(s).`);
      for (const finding of findings) console.error(`  - ${finding}`);
      if (findings.length > 0) process.exit(1);
      console.log('No findings.');
    } finally {
      await ds.destroy();
    }
    return;
  }

  if (command !== 'import') throw new Error(`Unknown command '${command}'`);

  const file = arg('file');
  if (!file) throw new Error('--file is required');
  const doc: RelationsFile = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'));

  const errors = validateRelationsFile(doc, snapshotRegistries(loaded));
  if (errors.length > 0) {
    console.error(`${errors.length} validation error(s) in ${file}:`);
    for (const error of errors.slice(0, 40)) console.error(`  - ${error}`);
    process.exit(1);
  }

  const ds = createDsdDataSource('curator', config);
  await ds.initialize();
  try {
    const senseIds = [
      ...new Set(doc.relations.flatMap((r) => [r.from_sense_id, r.to_sense_id])),
    ];
    const known: Array<{ id: string }> = await ds.query(SENSES_SQL, [senseIds]);
    const existing: ExistingRelation[] = await ds.query(EXISTING_SQL, [senseIds]);

    const plan = planRelationImport(doc, known.map((row) => row.id), existing);
    console.log(`  insert   ${plan.toInsert.length}`);
    console.log(`  blocked  ${plan.blocked.length}`);
    for (const reason of plan.blocked) console.error(`  - ${reason}`);
    if (plan.blocked.length > 0) {
      console.error('Refusing to import while any relation is blocked.');
      process.exit(1);
    }

    if (!process.argv.includes('--write')) {
      console.log('\nDRY RUN — nothing written. Re-run with --write.');
      return;
    }

    await ds.transaction(async (manager) => {
      for (const row of plan.toInsert) {
        const [inserted] = await manager.query(
          `INSERT INTO dsd_relations
             (from_sense_id, to_sense_id, relation_type, status, content_sha256,
              authored_by, source_id, batch_id, rights_evidence_id)
           VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8) RETURNING id`,
          [
            row.fromSenseId, row.toSenseId, row.relationType, row.contentSha256,
            row.authoredBy, row.sourceId, doc.batch_id, row.rightsEvidenceId,
          ],
        );
        await manager.query(
          `INSERT INTO dsd_provenance_events
             (entity_kind, entity_id, event_type, actor, output_hash, evidence_id)
           VALUES ('relation',$1,'authored',$2,$3,$4)`,
          [inserted.id, row.authoredBy, row.contentSha256, doc.declaration_id],
        );
      }
    });

    console.log(`\nImported ${plan.toInsert.length} relation(s) as drafts.`);
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
