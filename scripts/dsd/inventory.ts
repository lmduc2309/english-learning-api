/**
 * DSD headword inventory tool.
 *
 * The inventory is a product decision: which words DSD chooses to teach. It is
 * built from product requirements, never by exporting a legacy headword list.
 *
 * As much of this file is refusal as import. The inventory is the first place
 * legacy content could enter the corpus — a pasted column, a definition in the
 * wrong cell, a "helpful" frequency rank copied from the old database — and
 * anything that gets in here is laundered by every later step. So the column
 * set is an allowlist, known legacy-bearing names are named and rejected, and
 * values that look like content rather than headwords are refused.
 *
 * USAGE:
 *   npm run dsd:inventory:validate -- --file data/dsd/inventory/pilot.csv
 *   npm run dsd:inventory:import   -- --file data/dsd/inventory/pilot.csv
 *   npm run dsd:inventory:import   -- --file data/dsd/inventory/pilot.csv --write
 *   npm run dsd:inventory:stats
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { buildDsdCorpusConfig } from '../../src/dsd-corpus/dsd-corpus.config';
import { createDsdDataSource } from '../../src/dsd-corpus/dsd-corpus.datasource';

dotenv.config();

export const INVENTORY_COLUMNS = [
  'dsd_entry_id',
  'headword',
  'part_of_speech_expectation',
  'dsd_priority',
  'dsd_band',
  'product_rationale',
  'author_contributor_id',
  'authored_date',
  'inventory_evidence_id',
  'declaration_id',
] as const;

/**
 * Columns that would carry legacy identity or expressive content. Named
 * explicitly so the error says what is wrong rather than "unknown column".
 */
export const FORBIDDEN_COLUMNS = [
  'word_id',
  'definition_id',
  'source_definition_id',
  'source_sense_id',
  'example_id',
  'legacy_id',
  'definition',
  'definition_en',
  'definition_vi',
  'translation',
  'translation_vi',
  'example',
  'example_en',
  'example_vi',
  'ipa',
  'pronunciation',
  'frequency_rank',
  'ngsl_rank',
  'oewn_sense_id',
] as const;

const PART_OF_SPEECH = [
  'noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition',
  'conjunction', 'interjection', 'determiner', 'numeral', 'phrase',
] as const;

const PSEUDONYM_RE = /^DSD-[A-Z]-\d{3,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Latin letters, apostrophe, hyphen, and single spaces for multiword entries. */
const HEADWORD_RE = /^[A-Za-z][A-Za-z'\- ]*$/;
const MAX_HEADWORD_LENGTH = 40;
const MAX_HEADWORD_WORDS = 4;

export interface InventoryRow {
  dsd_entry_id: string;
  headword: string;
  part_of_speech_expectation: string;
  dsd_priority: string;
  dsd_band: string;
  product_rationale: string;
  author_contributor_id: string;
  authored_date: string;
  inventory_evidence_id: string;
  declaration_id: string;
}

export interface ExistingEntry {
  id: string;
  headwordNormalized: string;
  headword: string;
  dsdPriority: number | null;
  dsdBand: string | null;
  status: string;
}

export interface ImportPlan {
  toInsert: InventoryRow[];
  toUpdate: InventoryRow[];
  unchanged: InventoryRow[];
  rejected: string[];
}

/**
 * Deterministic normalization. Two spellings of the same word must converge,
 * or the unique constraint will happily hold both.
 */
export function normalizeHeadword(raw: string): {
  headword: string;
  headwordNormalized: string;
} {
  const headword = raw
    .normalize('NFC')
    // Curly apostrophes and primes all fold to the straight form.
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  return { headword, headwordNormalized: headword.toLowerCase() };
}

export function validateHeaders(headers: string[]): string[] {
  const errors: string[] = [];
  const seen = headers.map((h) => h.trim().toLowerCase());

  for (const header of seen) {
    if ((FORBIDDEN_COLUMNS as readonly string[]).includes(header)) {
      errors.push(
        `forbidden column '${header}': inventory carries headword selection only, ` +
          'never legacy identity or expressive content',
      );
    } else if (!(INVENTORY_COLUMNS as readonly string[]).includes(header)) {
      // Never ignore an unrecognised column — that is how content arrives.
      errors.push(`unknown column '${header}'`);
    }
  }

  for (const required of INVENTORY_COLUMNS) {
    if (!seen.includes(required)) {
      errors.push(`missing required column '${required}'`);
    }
  }

  return errors;
}

export function validateRow(row: InventoryRow, lineNumber: number): string[] {
  const errors: string[] = [];
  const at = (message: string) => errors.push(`row ${lineNumber}: ${message}`);

  const { headword } = normalizeHeadword(row.headword ?? '');

  if (!UUID_RE.test((row.dsd_entry_id ?? '').trim())) {
    at(`dsd_entry_id '${row.dsd_entry_id}' is not a UUID generated for DSD`);
  }

  if (!headword) {
    at('headword is empty');
  } else {
    if (headword.length > MAX_HEADWORD_LENGTH) {
      at(`headword is too long (${headword.length} chars) — this looks like a definition`);
    }
    if (headword.split(' ').length > MAX_HEADWORD_WORDS) {
      at('headword has too many words — a sentence is not a headword');
    }
    if (/[.!?;:,]/.test(headword)) {
      at('headword contains sentence punctuation');
    }
    if (!HEADWORD_RE.test(headword)) {
      // Vietnamese diacritics land here, which means a translation was pasted
      // into the headword column.
      at(`headword contains non-English characters: '${headword}'`);
    }
  }

  if (!(PART_OF_SPEECH as readonly string[]).includes(row.part_of_speech_expectation?.trim())) {
    at(`unknown part of speech '${row.part_of_speech_expectation}'`);
  }

  const priority = Number(row.dsd_priority);
  if (!Number.isInteger(priority) || priority <= 0) {
    at(`dsd_priority must be a positive integer, got '${row.dsd_priority}'`);
  }

  if (!(row.product_rationale ?? '').trim()) {
    at('product_rationale is required — inventory selection is a product decision');
  }

  if (!PSEUDONYM_RE.test((row.author_contributor_id ?? '').trim())) {
    at(
      `author_contributor_id '${row.author_contributor_id}' is not a pseudonymous ID ` +
        '(expected DSD-<LETTER>-<digits>); names never enter Git',
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test((row.authored_date ?? '').trim())) {
    at(`authored_date must be YYYY-MM-DD, got '${row.authored_date}'`);
  }

  if (!(row.inventory_evidence_id ?? '').trim()) {
    at('inventory_evidence_id is required');
  }

  if (!(row.declaration_id ?? '').trim()) {
    at('declaration_id is required — every batch needs a signed clean-room declaration');
  }

  return errors;
}

export function planImport(rows: InventoryRow[], existing: ExistingEntry[]): ImportPlan {
  const plan: ImportPlan = { toInsert: [], toUpdate: [], unchanged: [], rejected: [] };
  const byNormalized = new Map(existing.map((e) => [e.headwordNormalized, e]));
  const byId = new Map(existing.map((e) => [e.id.toLowerCase(), e]));
  const seen = new Map<string, number>();
  const seenIds = new Map<string, number>();

  rows.forEach((row, index) => {
    const { headword, headwordNormalized } = normalizeHeadword(row.headword ?? '');
    const id = row.dsd_entry_id.toLowerCase();

    const previous = seen.get(headwordNormalized);
    if (previous !== undefined) {
      plan.rejected.push(
        `duplicate headword '${headword}' at rows ${previous + 2} and ${index + 2}`,
      );
      return;
    }
    seen.set(headwordNormalized, index);

    const previousId = seenIds.get(id);
    if (previousId !== undefined) {
      plan.rejected.push(
        `duplicate dsd_entry_id '${row.dsd_entry_id}' at rows ${previousId + 2} and ${index + 2}`,
      );
      return;
    }
    seenIds.set(id, index);

    const currentById = byId.get(id);
    if (currentById && currentById.headwordNormalized !== headwordNormalized) {
      plan.rejected.push(
        `dsd_entry_id '${row.dsd_entry_id}' already belongs to '${currentById.headword}', ` +
          `not '${headword}'`,
      );
      return;
    }

    const current = byNormalized.get(headwordNormalized);
    if (!current) {
      plan.toInsert.push(row);
      return;
    }

    if (current.id.toLowerCase() !== id) {
      plan.rejected.push(
        `'${headword}' already exists as ${current.id}; refusing a second DSD identity ${row.dsd_entry_id}`,
      );
      return;
    }

    const changed =
      current.headword !== headword ||
      current.dsdPriority !== Number(row.dsd_priority) ||
      (current.dsdBand ?? '') !== (row.dsd_band ?? '').trim();

    if (!changed) {
      // Idempotent regardless of status: re-running the same file is a no-op.
      plan.unchanged.push(row);
      return;
    }

    if (current.status === 'approved' || current.status === 'published') {
      plan.rejected.push(
        `'${headword}' is ${current.status} and cannot be changed by import; ` +
          'use the amendment workflow',
      );
      return;
    }

    plan.toUpdate.push(row);
  });

  return plan;
}

// ─── I/O ────────────────────────────────────────────────────────────────────

/** Minimal RFC4180 reader: quoted fields, doubled quotes, embedded commas. */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;

  const body = text.replace(/^﻿/, '');
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (quoted) {
      if (char === '"') {
        if (body[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
      } else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { record.push(field); field = ''; continue; }
    if (char === '\n') {
      record.push(field.replace(/\r$/, ''));
      records.push(record);
      record = []; field = '';
      continue;
    }
    field += char;
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field.replace(/\r$/, ''));
    records.push(record);
  }

  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ''));
  return { headers: nonEmpty[0] ?? [], rows: nonEmpty.slice(1) };
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function loadFile(file: string): { rows: InventoryRow[]; errors: string[] } {
  const { headers, rows } = parseCsv(fs.readFileSync(file, 'utf8'));
  const errors = validateHeaders(headers);
  if (errors.length > 0) return { rows: [], errors };

  const keys = headers.map((h) => h.trim().toLowerCase());
  const parsed = rows.map(
    (cells) =>
      Object.fromEntries(keys.map((k, i) => [k, (cells[i] ?? '').trim()])) as unknown as InventoryRow,
  );

  parsed.forEach((row, index) => errors.push(...validateRow(row, index + 2)));
  return { rows: parsed, errors };
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!['validate', 'import', 'stats'].includes(command)) {
    throw new Error('Usage: inventory.ts <validate|import|stats> [--file <csv>] [--write]');
  }

  const config = buildDsdCorpusConfig();
  if (config.errors.length > 0) {
    throw new Error('DSD configuration invalid:\n  - ' + config.errors.join('\n  - '));
  }

  if (command === 'stats') {
    const ds = createDsdDataSource('curator', config);
    await ds.initialize();
    try {
      const rows = await ds.query(
        `SELECT status, count(*)::int AS n FROM dsd_entries GROUP BY status ORDER BY status`,
      );
      const total = rows.reduce((sum: number, r: any) => sum + r.n, 0);
      console.log(`DSD inventory: ${total} headword(s)`);
      for (const r of rows) console.log(`  ${String(r.status).padEnd(10)} ${r.n}`);
    } finally {
      await ds.destroy();
    }
    return;
  }

  const file = arg('file');
  if (!file) throw new Error('--file is required');
  const resolved = path.resolve(process.cwd(), file);

  const { rows, errors } = loadFile(resolved);
  if (errors.length > 0) {
    console.error(`${errors.length} validation error(s) in ${file}:`);
    for (const error of errors.slice(0, 40)) console.error(`  - ${error}`);
    if (errors.length > 40) console.error(`  … ${errors.length - 40} more`);
    process.exit(1);
  }
  console.log(`${rows.length} row(s) valid.`);
  if (command === 'validate') return;

  const write = process.argv.includes('--write');
  const ds = createDsdDataSource('curator', config);
  await ds.initialize();
  try {
    const existing: ExistingEntry[] = (
      await ds.query(
        `SELECT id, headword_normalized AS "headwordNormalized", headword,
                dsd_priority AS "dsdPriority", dsd_band AS "dsdBand", status
           FROM dsd_entries`,
      )
    ).map((r: any) => ({ ...r, dsdPriority: r.dsdPriority === null ? null : Number(r.dsdPriority) }));

    const plan = planImport(rows, existing);

    console.log(`  insert    ${plan.toInsert.length}`);
    console.log(`  update    ${plan.toUpdate.length}`);
    console.log(`  unchanged ${plan.unchanged.length}`);
    console.log(`  rejected  ${plan.rejected.length}`);
    for (const rejection of plan.rejected) console.error(`  - ${rejection}`);

    if (plan.rejected.length > 0) {
      console.error('Refusing to import while rejections stand.');
      process.exit(1);
    }

    if (!write) {
      console.log('\nDRY RUN — nothing written. Re-run with --write to apply.');
      return;
    }

    // One transaction: an inventory batch lands completely or not at all.
    await ds.transaction(async (manager) => {
      for (const row of plan.toInsert) {
        const { headword, headwordNormalized } = normalizeHeadword(row.headword);
        const [entry] = await manager.query(
          `INSERT INTO dsd_entries
             (id, headword, headword_normalized, dsd_priority, dsd_band,
              inventory_evidence_id, status)
           VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,'draft') RETURNING id`,
          [
            row.dsd_entry_id, headword, headwordNormalized, Number(row.dsd_priority),
            row.dsd_band ?? '', row.inventory_evidence_id,
          ],
        );
        await manager.query(
          `INSERT INTO dsd_provenance_events
             (entity_kind, entity_id, event_type, actor, evidence_id)
           VALUES ('entry',$1,'imported',$2,$3)`,
          [entry.id, row.author_contributor_id, row.declaration_id],
        );
      }

      for (const row of plan.toUpdate) {
        const { headword, headwordNormalized } = normalizeHeadword(row.headword);
        const [entry] = await manager.query(
          `UPDATE dsd_entries
              SET headword=$1, dsd_priority=$2, dsd_band=NULLIF($3,''), updated_at=now()
            WHERE id=$4 RETURNING id`,
          [headword, Number(row.dsd_priority), row.dsd_band ?? '', row.dsd_entry_id],
        );
        await manager.query(
          `INSERT INTO dsd_provenance_events
             (entity_kind, entity_id, event_type, actor, evidence_id)
           VALUES ('entry',$1,'imported',$2,$3)`,
          [entry.id, row.author_contributor_id, row.declaration_id],
        );
      }
    });

    console.log(`\nImported. ${plan.toInsert.length} inserted, ${plan.toUpdate.length} updated.`);
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
