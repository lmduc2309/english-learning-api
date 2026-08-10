/**
 * Resumable DSD direct-OpenAI generation entry point.
 *
 * `prepare` is offline and produces deterministic Batch API JSONL plus a
 * checksum manifest. `calibrate` is the only synchronous mode and is bounded
 * by explicit request/token/cost limits. Neither command imports, approves, or
 * publishes content.
 *
 * USAGE:
 *   npm run dsd:ai:prepare -- --inventory <csv> --batch <id> --output <dir> --limit 50
 *   OPENAI_API_KEY=... DSD_AI_INPUT_MICROUSD_PER_MTOK=... \
 *     DSD_AI_OUTPUT_MICROUSD_PER_MTOK=... npm run dsd:ai:calibrate -- \
 *     --inventory <csv> --batch <id> --output <json> --limit 50
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { CurationPackage } from '../curation';
import { InventoryRow, loadInventoryFile, normalizeHeadword } from '../inventory';
import {
  DEFAULT_DSD_MODEL,
  DSD_GENERATED_SOURCE,
  DSD_GENERATOR_ACTOR,
  DSD_GENERATOR_TOOL,
  DSD_PROMPT_POLICY,
  DSD_TERMS_EVIDENCE,
  PreparedBatchManifest,
  buildBatchRequestLine,
  buildResponseBody,
  createDirectOpenAiClient,
  loadDirectOpenAiConfig,
  loadEntryOutputSchema,
  sha256,
  TEXT_SYSTEM_INSTRUCTIONS,
  GeneratedEntryOutput,
  validateGeneratedEntry,
} from './direct-openai';

dotenv.config();

const TARGET_ID = 'DSD-TARGET-LEGACY-PARITY-20260809';
const TOOL_REVISION = 'openai-node-6.38.0';
const DECLARATION_ID = 'DSD-AI-DECL-FULL-CORPUS-20260810-001';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveArg(name: string, fallback: number): number {
  const raw = arg(name);
  const parsed = raw == null ? fallback : Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive safe integer`);
  }
  return parsed;
}

function loadRows(file: string, limit: number): InventoryRow[] {
  const resolved = path.resolve(process.cwd(), file);
  const loaded = loadInventoryFile(resolved);
  if (loaded.errors.length > 0) {
    throw new Error(`Invalid inventory:\n  - ${loaded.errors.join('\n  - ')}`);
  }
  if (loaded.rows.length < limit) {
    throw new Error(`Inventory has ${loaded.rows.length} rows, below requested limit ${limit}`);
  }
  return loaded.rows.slice(0, limit);
}

function requireBatchId(): string {
  const batchId = (arg('batch') ?? '').trim();
  if (!/^[A-Z0-9][A-Z0-9._-]{7,63}$/.test(batchId)) {
    throw new Error('--batch must be 8..64 uppercase letters, digits, dot, underscore, or hyphen');
  }
  return batchId;
}

function canonicalInputs(rows: InventoryRow[]): string {
  return JSON.stringify(rows.map((row) => ({
    dsd_entry_id: row.dsd_entry_id,
    headword: normalizeHeadword(row.headword).headword,
    part_of_speech_expectation: row.part_of_speech_expectation,
    product_rationale: row.product_rationale,
  })));
}

export function prepareBatch(
  rows: InventoryRow[],
  batchId: string,
  model = DEFAULT_DSD_MODEL,
  schema = loadEntryOutputSchema(),
): { jsonl: string; manifest: PreparedBatchManifest } {
  const jsonl = rows
    .map((row) => JSON.stringify(buildBatchRequestLine(row, model, schema)))
    .join('\n') + '\n';
  const input = canonicalInputs(rows);
  return {
    jsonl,
    manifest: {
      manifest_version: 1,
      batch_id: batchId,
      target_id: TARGET_ID,
      provider_id: 'openai',
      endpoint: '/v1/responses',
      requested_model: model,
      request_count: rows.length,
      prompt_sha256: sha256(TEXT_SYSTEM_INSTRUCTIONS),
      schema_sha256: sha256(JSON.stringify(schema)),
      input_sha256: sha256(input),
      jsonl_sha256: sha256(jsonl),
      legacy_input_used: false,
    },
  };
}

function toCurationEntry(row: InventoryRow, output: GeneratedEntryOutput) {
  return {
    dsd_entry_id: row.dsd_entry_id,
    headword: normalizeHeadword(row.headword).headword,
    product_rationale: row.product_rationale,
    senses: [{
      sense_key: output.sense_key,
      sense_order: 1,
      part_of_speech: output.part_of_speech,
      definition_en: output.definition_en.trim(),
      usage_labels: output.usage_labels,
      authored_by: DSD_GENERATOR_ACTOR,
      source_id: DSD_GENERATED_SOURCE,
      rights_evidence_id: DSD_TERMS_EVIDENCE,
      translation: {
        locale: 'vi',
        text: output.translation_vi.trim(),
        authored_by: DSD_GENERATOR_ACTOR,
        source_id: DSD_GENERATED_SOURCE,
        rights_evidence_id: DSD_TERMS_EVIDENCE,
      },
      examples: [{
        example_order: 1,
        en: output.example_en.trim(),
        vi: output.example_vi.trim(),
        authored_by: DSD_GENERATOR_ACTOR,
        source_id: DSD_GENERATED_SOURCE,
        rights_evidence_id: DSD_TERMS_EVIDENCE,
      }],
    }],
  };
}

export interface Pricing {
  inputMicrousdPerMtok: number;
  outputMicrousdPerMtok: number;
}

export function loadPricing(env: NodeJS.ProcessEnv = process.env): Pricing {
  const read = (name: string): number => {
    const value = Number(env[name]);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(
        `${name} must be set to the current positive integer micro-USD price per 1M tokens`,
      );
    }
    return value;
  };
  return {
    inputMicrousdPerMtok: read('DSD_AI_INPUT_MICROUSD_PER_MTOK'),
    outputMicrousdPerMtok: read('DSD_AI_OUTPUT_MICROUSD_PER_MTOK'),
  };
}

export function calculateCostMicrousd(
  inputTokens: number,
  outputTokens: number,
  pricing: Pricing,
): number {
  return Math.ceil(
    (inputTokens * pricing.inputMicrousdPerMtok +
      outputTokens * pricing.outputMicrousdPerMtok) / 1_000_000,
  );
}

async function calibrate(
  rows: InventoryRow[],
  batchId: string,
  outputFile: string,
): Promise<void> {
  const config = loadDirectOpenAiConfig(process.env, true);
  const pricing = loadPricing();
  if (rows.length > config.maxRequests) {
    throw new Error(`Calibration has ${rows.length} requests, above DSD_AI_MAX_REQUESTS=${config.maxRequests}`);
  }
  const schema = loadEntryOutputSchema();
  const client = createDirectOpenAiClient(config);
  const entries: ReturnType<typeof toCurationEntry>[] = [];
  const responseModels = new Set<string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let costMicrousd = 0;

  for (const [index, row] of rows.entries()) {
    const response = await client.responses.create(
      buildResponseBody(row, config.model, schema) as any,
    );
    const nextInput = Number(response.usage?.input_tokens ?? 0);
    const nextOutput = Number(response.usage?.output_tokens ?? 0);
    inputTokens += nextInput;
    outputTokens += nextOutput;
    costMicrousd += calculateCostMicrousd(nextInput, nextOutput, pricing);

    if (inputTokens > config.maxInputTokens || outputTokens > config.maxOutputTokens) {
      throw new Error('Calibration token ceiling reached; stopping before another request');
    }
    if (costMicrousd > config.maxCostMicrousd) {
      throw new Error('Calibration cost ceiling reached; stopping before another request');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.output_text);
    } catch {
      throw new Error(`Response ${response.id} for ${row.dsd_entry_id} was not JSON`);
    }
    const errors = validateGeneratedEntry(parsed, row);
    if (errors.length > 0) {
      throw new Error(
        `Generated entry ${row.dsd_entry_id} failed validation:\n  - ${errors.join('\n  - ')}`,
      );
    }
    entries.push(toCurationEntry(row, parsed as GeneratedEntryOutput));
    responseModels.add(response.model);
    console.log(
      `[${index + 1}/${rows.length}] ${row.headword} ` +
      `input=${nextInput} output=${nextOutput} cost_microusd=${costMicrousd}`,
    );
  }

  if (responseModels.size !== 1) {
    throw new Error(`Provider returned multiple model identities: ${[...responseModels].join(', ')}`);
  }
  const inputSha = sha256(canonicalInputs(rows));
  const pkg: CurationPackage = {
    package_version: 1,
    batch_id: batchId,
    declaration_id: DECLARATION_ID,
    generation: {
      generator_actor_id: DSD_GENERATOR_ACTOR,
      generator_tool_id: DSD_GENERATOR_TOOL,
      generator_tool_revision: TOOL_REVISION,
      generated_source_id: DSD_GENERATED_SOURCE,
      provider_id: 'openai',
      product_id: 'api',
      runtime_model_id: [...responseModels][0],
      generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      prompt_policy_id: DSD_PROMPT_POLICY,
      input_sha256: inputSha,
      terms_evidence_id: DSD_TERMS_EVIDENCE,
      legacy_input_used: false,
    },
    entries,
  };

  const resolved = path.resolve(process.cwd(), outputFile);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(pkg, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({
    output: resolved,
    requests: rows.length,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_microusd: costMicrousd,
    model: [...responseModels][0],
  }, null, 2));
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!['prepare', 'calibrate'].includes(command)) {
    throw new Error('Usage: generate.ts <prepare|calibrate> --inventory <csv> --batch <id> --output <path> [--limit N]');
  }
  const inventory = arg('inventory');
  const output = arg('output');
  if (!inventory || !output) throw new Error('--inventory and --output are required');
  const batchId = requireBatchId();
  const config = loadDirectOpenAiConfig(process.env, command === 'calibrate');
  const limit = positiveArg('limit', Math.min(50, config.maxRequests));
  if (limit > config.maxRequests) {
    throw new Error(`--limit ${limit} exceeds DSD_AI_MAX_REQUESTS=${config.maxRequests}`);
  }
  const rows = loadRows(inventory, limit);

  if (command === 'calibrate') {
    await calibrate(rows, batchId, output);
    return;
  }

  const prepared = prepareBatch(rows, batchId, config.model);
  const outputDir = path.resolve(process.cwd(), output);
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonlFile = path.join(outputDir, `${batchId}.jsonl`);
  const manifestFile = path.join(outputDir, `${batchId}.manifest.json`);
  fs.writeFileSync(jsonlFile, prepared.jsonl, { mode: 0o600 });
  fs.writeFileSync(manifestFile, JSON.stringify(prepared.manifest, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ jsonl: jsonlFile, manifest: manifestFile, ...prepared.manifest }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
