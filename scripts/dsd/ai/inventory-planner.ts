/**
 * Build independent DSD headword-candidate requests from DSD-owned coverage
 * cells. No legacy list, count-by-category, rank, or content enters a request.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { normalizeHeadword } from '../inventory';
import { loadDirectOpenAiConfig, sha256 } from './direct-openai';

dotenv.config();

export const INVENTORY_INSTRUCTIONS = `Create independent candidate headwords for the DSD English-learning product.
Use only the supplied DSD coverage cell. Do not reproduce, enumerate, imitate, or claim to match any dictionary, corpus, frequency list, source inventory, or legacy dataset.
Return real established English lexical items appropriate to the requested part of speech, level, register, and topic.
Do not invent spellings. Do not include proper names, trademarks, abbreviations, definitions, translations, IPA, examples, ranks, IDs, or source references.
Within this response, every normalized headword must be unique.
Give a short DSD product rationale written from scratch for each candidate.
Return exactly the structured object requested.`;

export interface InventoryPlan {
  plan_version: 1;
  plan_id: string;
  target_id: string;
  active_target: number;
  candidate_target: number;
  candidates_per_cell: number;
  levels: string[];
  registers: string[];
  parts_of_speech: string[];
  topics: string[];
  legacy_inventory_used: false;
}

export interface InventoryCell {
  index: number;
  id: string;
  level: string;
  register: string;
  partOfSpeech: string;
  topic: string;
  count: number;
}

export interface InventoryCandidate {
  headword: string;
  part_of_speech: string;
  product_rationale: string;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveArg(name: string, fallback: number): number {
  const raw = arg(name);
  const value = raw == null ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`--${name} must be a non-negative integer`);
  return value;
}

export function validateInventoryPlan(plan: InventoryPlan): string[] {
  const errors: string[] = [];
  const allowed = [
    'plan_version', 'plan_id', 'target_id', 'active_target', 'candidate_target',
    'candidates_per_cell', 'levels', 'registers', 'parts_of_speech', 'topics',
    'legacy_inventory_used',
  ];
  for (const key of Object.keys(plan as any)) {
    if (!allowed.includes(key)) errors.push(`unknown plan field '${key}'`);
  }
  if (plan.plan_version !== 1) errors.push('plan_version must be 1');
  if (plan.target_id !== 'DSD-TARGET-LEGACY-PARITY-20260809') errors.push('unexpected target_id');
  if (plan.active_target !== 475_153) errors.push('active_target must be 475153');
  if (plan.candidate_target < plan.active_target) errors.push('candidate_target must cover active_target');
  if (plan.legacy_inventory_used !== false) errors.push('legacy_inventory_used must be false');
  for (const key of ['levels', 'registers', 'parts_of_speech', 'topics'] as const) {
    if (!Array.isArray(plan[key]) || plan[key].length === 0) errors.push(`${key} must be non-empty`);
  }
  const cellCount = plan.levels.length * plan.registers.length *
    plan.parts_of_speech.length * plan.topics.length;
  if (cellCount * plan.candidates_per_cell !== plan.candidate_target) {
    errors.push(
      `${cellCount} cells x ${plan.candidates_per_cell} candidates does not equal ` +
      `candidate_target ${plan.candidate_target}`,
    );
  }
  return errors;
}

export function buildInventoryCells(plan: InventoryPlan): InventoryCell[] {
  const cells: InventoryCell[] = [];
  for (const level of plan.levels) {
    for (const register of plan.registers) {
      for (const partOfSpeech of plan.parts_of_speech) {
        for (const topic of plan.topics) {
          const index = cells.length;
          cells.push({
            index,
            id: `DSD-INV-CELL-${String(index + 1).padStart(5, '0')}`,
            level,
            register,
            partOfSpeech,
            topic,
            count: plan.candidates_per_cell,
          });
        }
      }
    }
  }
  return cells;
}

export function buildInventoryCellRequest(
  cell: InventoryCell,
  model: string,
  schema: Record<string, unknown>,
) {
  return {
    custom_id: cell.id,
    method: 'POST' as const,
    url: '/v1/responses' as const,
    body: {
      model,
      instructions: INVENTORY_INSTRUCTIONS,
      input: [
        `DSD cell: ${cell.id}`,
        `Learner level: ${cell.level}`,
        `Register: ${cell.register}`,
        `Part of speech: ${cell.partOfSpeech}`,
        `Topic: ${cell.topic}`,
        `Candidate count: ${cell.count}`,
      ].join('\n'),
      max_output_tokens: 8_000,
      store: false,
      text: {
        format: {
          type: 'json_schema',
          name: 'dsd_inventory_candidates',
          strict: true,
          schema,
        },
      },
      metadata: {
        dsd_cell_id: cell.id,
        target_id: 'DSD-TARGET-LEGACY-PARITY-20260809',
        legacy_input_used: 'false',
      },
    },
  };
}

export function validateCellCandidates(
  value: unknown,
  cell: InventoryCell,
): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== 'object' || !Array.isArray((value as any).candidates)) {
    return ['output.candidates must be an array'];
  }
  const candidates = (value as any).candidates as InventoryCandidate[];
  if (candidates.length !== cell.count) errors.push(`expected ${cell.count} candidates, got ${candidates.length}`);
  const normalized = new Set<string>();
  candidates.forEach((candidate, index) => {
    const where = `candidate ${index + 1}`;
    const keys = Object.keys(candidate ?? {});
    if (keys.some((key) => !['headword', 'part_of_speech', 'product_rationale'].includes(key))) {
      errors.push(`${where} contains an unknown field`);
    }
    const headword = normalizeHeadword(candidate?.headword ?? '');
    if (!/^[A-Za-z][A-Za-z' -]*$/.test(headword.headword) || headword.headword.length > 40) {
      errors.push(`${where} has an invalid English headword`);
    }
    if (normalized.has(headword.headwordNormalized)) errors.push(`${where} duplicates '${headword.headword}'`);
    normalized.add(headword.headwordNormalized);
    if (candidate?.part_of_speech !== cell.partOfSpeech) errors.push(`${where} has the wrong part of speech`);
    const rationale = (candidate?.product_rationale ?? '').trim();
    if (rationale.length < 8 || rationale.length > 180) errors.push(`${where} has an invalid rationale`);
  });
  return errors;
}

/** Stable DSD identity derived only from DSD namespace plus normalized headword. */
export function stableDsdEntryId(headword: string): string {
  const digest = Buffer.from(sha256(`DSD-FULL-CORPUS-V1\0${normalizeHeadword(headword).headwordNormalized}`), 'hex');
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== 'prepare') {
    throw new Error('Usage: inventory-planner.ts prepare --plan <json> --output <dir> [--offset N] [--limit N]');
  }
  const planArg = arg('plan');
  const outputArg = arg('output');
  if (!planArg || !outputArg) throw new Error('--plan and --output are required');
  const plan = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), planArg), 'utf8')) as InventoryPlan;
  const errors = validateInventoryPlan(plan);
  if (errors.length > 0) throw new Error(`Invalid inventory plan:\n  - ${errors.join('\n  - ')}`);

  const config = loadDirectOpenAiConfig(process.env, false);
  const offset = positiveArg('offset', 0);
  const limit = positiveArg('limit', Math.min(config.maxRequests, 50_000));
  if (limit === 0) throw new Error('--limit must be greater than zero');
  if (limit > config.maxRequests) throw new Error(`--limit exceeds DSD_AI_MAX_REQUESTS=${config.maxRequests}`);
  const allCells = buildInventoryCells(plan);
  const cells = allCells.slice(offset, offset + limit);
  if (cells.length !== limit) throw new Error(`Requested cells ${offset}..${offset + limit - 1} exceed ${allCells.length} cells`);

  const schemaFile = path.resolve(process.cwd(), 'data/dsd/schemas/ai-inventory-cell-output.schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8')) as Record<string, unknown>;
  const jsonl = cells.map((cell) => JSON.stringify(buildInventoryCellRequest(cell, config.model, schema))).join('\n') + '\n';
  const manifest = {
    manifest_version: 1,
    plan_id: plan.plan_id,
    target_id: plan.target_id,
    provider_id: 'openai',
    endpoint: '/v1/responses',
    requested_model: config.model,
    cell_offset: offset,
    cell_count: cells.length,
    candidate_count: cells.reduce((sum, cell) => sum + cell.count, 0),
    prompt_sha256: sha256(INVENTORY_INSTRUCTIONS),
    schema_sha256: sha256(JSON.stringify(schema)),
    plan_sha256: sha256(JSON.stringify(plan)),
    jsonl_sha256: sha256(jsonl),
    legacy_input_used: false,
  };
  const outputDir = path.resolve(process.cwd(), outputArg);
  fs.mkdirSync(outputDir, { recursive: true });
  const stem = `${plan.plan_id}-${String(offset).padStart(5, '0')}-${String(cells.length).padStart(5, '0')}`;
  fs.writeFileSync(path.join(outputDir, `${stem}.jsonl`), jsonl, { mode: 0o600 });
  fs.writeFileSync(path.join(outputDir, `${stem}.manifest.json`), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ output_dir: outputDir, stem, ...manifest }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
