/**
 * Submit and retrieve direct OpenAI Batch jobs prepared by generate.ts.
 *
 * The upload is refused unless the JSONL exactly matches its manifest, every
 * request targets /v1/responses at api.openai.com, and the request count stays
 * inside the configured ceiling. Receipts contain IDs and hashes, never keys.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import OpenAI from 'openai';
import {
  PreparedBatchManifest,
  createDirectOpenAiClient,
  loadDirectOpenAiConfig,
  sha256,
} from './direct-openai';
import { Pricing, calculateCostMicrousd, loadPricing } from './generate';

dotenv.config();

export interface BatchReceipt {
  receipt_version: 1;
  dsd_batch_id: string;
  provider_id: 'openai';
  provider_file_id: string;
  provider_batch_id: string;
  endpoint: '/v1/responses';
  requested_model: string;
  request_count: number;
  jsonl_sha256: string;
  estimated_input_tokens: number;
  maximum_output_tokens: number;
  estimated_max_cost_microusd: number;
  input_price_microusd_per_mtok: number;
  output_price_microusd_per_mtok: number;
  submitted_at: string;
}

export interface BatchBudgetEstimate {
  estimatedInputTokens: number;
  maximumOutputTokens: number;
  estimatedMaxCostMicrousd: number;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')) as T;
}

export function validatePreparedBatch(
  jsonl: string,
  manifest: PreparedBatchManifest,
  maxRequests: number,
): string[] {
  const errors: string[] = [];
  const lines = jsonl.trim().split('\n').filter(Boolean);
  if (sha256(jsonl) !== manifest.jsonl_sha256) errors.push('JSONL SHA-256 does not match manifest');
  if (lines.length !== manifest.request_count) errors.push('JSONL line count does not match manifest');
  if (lines.length > maxRequests) errors.push(`request count ${lines.length} exceeds configured maximum ${maxRequests}`);
  if (Buffer.byteLength(jsonl) > 200 * 1024 * 1024) errors.push('JSONL exceeds the Batch API 200 MB limit');
  if (manifest.provider_id !== 'openai') errors.push('manifest provider_id must be openai');
  if (manifest.endpoint !== '/v1/responses') errors.push('manifest endpoint must be /v1/responses');
  if (manifest.legacy_input_used !== false) errors.push('manifest legacy_input_used must be false');

  const customIds = new Set<string>();
  lines.forEach((line, index) => {
    let request: any;
    try {
      request = JSON.parse(line);
    } catch {
      errors.push(`line ${index + 1} is not JSON`);
      return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/responses') {
      errors.push(`line ${index + 1} must POST /v1/responses`);
    }
    if (request.body?.model !== manifest.requested_model) {
      errors.push(`line ${index + 1} model differs from manifest`);
    }
    if (request.body?.store !== false) errors.push(`line ${index + 1} must set store=false`);
    if (request.body?.metadata?.legacy_input_used !== 'false') {
      errors.push(`line ${index + 1} does not declare legacy_input_used=false`);
    }
    if (!request.custom_id || customIds.has(request.custom_id)) {
      errors.push(`line ${index + 1} has a missing or duplicate custom_id`);
    }
    customIds.add(request.custom_id);
    if (/openrouter\.ai|openai\//i.test(JSON.stringify(request))) {
      errors.push(`line ${index + 1} contains a router endpoint or model identifier`);
    }
  });
  return errors;
}

/**
 * Conservative preflight estimate. Character/3 intentionally overestimates
 * ordinary English tokenization, and output uses every request's hard maximum.
 * The account-side project spend limit remains the outer backstop.
 */
export function estimateBatchBudget(jsonl: string, pricing: Pricing): BatchBudgetEstimate {
  let inputCharacters = 0;
  let maximumOutputTokens = 0;
  for (const line of jsonl.trim().split('\n').filter(Boolean)) {
    const request = JSON.parse(line) as any;
    const body = request.body ?? {};
    inputCharacters += JSON.stringify({
      instructions: body.instructions,
      input: body.input,
      text: body.text,
    }).length;
    maximumOutputTokens += Number(body.max_output_tokens ?? 0);
  }
  const estimatedInputTokens = Math.ceil(inputCharacters / 3);
  return {
    estimatedInputTokens,
    maximumOutputTokens,
    estimatedMaxCostMicrousd: calculateCostMicrousd(
      estimatedInputTokens,
      maximumOutputTokens,
      pricing,
    ),
  };
}

export async function submitPreparedBatch(
  client: OpenAI,
  jsonlFile: string,
  manifest: PreparedBatchManifest,
  estimate: BatchBudgetEstimate,
  pricing: Pricing,
): Promise<BatchReceipt> {
  const uploaded = await client.files.create({
    file: fs.createReadStream(jsonlFile),
    purpose: 'batch',
  });
  const batch = await client.batches.create({
    input_file_id: uploaded.id,
    endpoint: '/v1/responses',
    completion_window: '24h',
    metadata: {
      dsd_batch_id: manifest.batch_id,
      target_id: manifest.target_id,
      jsonl_sha256: manifest.jsonl_sha256,
    },
  });
  return {
    receipt_version: 1,
    dsd_batch_id: manifest.batch_id,
    provider_id: 'openai',
    provider_file_id: uploaded.id,
    provider_batch_id: batch.id,
    endpoint: '/v1/responses',
    requested_model: manifest.requested_model,
    request_count: manifest.request_count,
    jsonl_sha256: manifest.jsonl_sha256,
    estimated_input_tokens: estimate.estimatedInputTokens,
    maximum_output_tokens: estimate.maximumOutputTokens,
    estimated_max_cost_microusd: estimate.estimatedMaxCostMicrousd,
    input_price_microusd_per_mtok: pricing.inputMicrousdPerMtok,
    output_price_microusd_per_mtok: pricing.outputMicrousdPerMtok,
    submitted_at: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!['submit', 'status', 'download'].includes(command)) {
    throw new Error('Usage: batch.ts <submit|status|download> [options]');
  }
  const config = loadDirectOpenAiConfig(process.env, true);
  const client = createDirectOpenAiClient(config);

  if (command === 'submit') {
    const jsonlArg = arg('jsonl');
    const manifestArg = arg('manifest');
    const receiptArg = arg('receipt');
    if (!jsonlArg || !manifestArg || !receiptArg) {
      throw new Error('submit requires --jsonl, --manifest, and --receipt');
    }
    const jsonlFile = path.resolve(process.cwd(), jsonlArg);
    const jsonl = fs.readFileSync(jsonlFile, 'utf8');
    const manifest = readJson<PreparedBatchManifest>(manifestArg);
    const errors = validatePreparedBatch(jsonl, manifest, config.maxRequests);
    if (errors.length > 0) throw new Error(`Prepared batch refused:\n  - ${errors.join('\n  - ')}`);
    const pricing = loadPricing();
    const estimate = estimateBatchBudget(jsonl, pricing);
    if (estimate.estimatedInputTokens > config.maxInputTokens) {
      throw new Error(
        `Estimated input ${estimate.estimatedInputTokens} exceeds ` +
        `DSD_AI_MAX_INPUT_TOKENS=${config.maxInputTokens}`,
      );
    }
    if (estimate.maximumOutputTokens > config.maxOutputTokens) {
      throw new Error(
        `Maximum output ${estimate.maximumOutputTokens} exceeds ` +
        `DSD_AI_MAX_OUTPUT_TOKENS=${config.maxOutputTokens}`,
      );
    }
    if (estimate.estimatedMaxCostMicrousd > config.maxCostMicrousd) {
      throw new Error(
        `Estimated maximum cost ${estimate.estimatedMaxCostMicrousd} micro-USD exceeds ` +
        `DSD_AI_MAX_COST_MICROUSD=${config.maxCostMicrousd}`,
      );
    }
    const receipt = await submitPreparedBatch(client, jsonlFile, manifest, estimate, pricing);
    const receiptFile = path.resolve(process.cwd(), receiptArg);
    fs.mkdirSync(path.dirname(receiptFile), { recursive: true });
    fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(receipt, null, 2));
    return;
  }

  const receiptArg = arg('receipt');
  if (!receiptArg) throw new Error('--receipt is required');
  const receipt = readJson<BatchReceipt>(receiptArg);
  const batch = await client.batches.retrieve(receipt.provider_batch_id);

  if (command === 'status') {
    console.log(JSON.stringify({
      dsd_batch_id: receipt.dsd_batch_id,
      provider_batch_id: batch.id,
      status: batch.status,
      request_counts: batch.request_counts,
      output_file_id: batch.output_file_id,
      error_file_id: batch.error_file_id,
      created_at: batch.created_at,
      completed_at: batch.completed_at,
      expires_at: batch.expires_at,
    }, null, 2));
    return;
  }

  const outputArg = arg('output');
  if (!outputArg) throw new Error('download requires --output');
  if (batch.status !== 'completed' || !batch.output_file_id) {
    throw new Error(`Batch ${batch.id} is '${batch.status}', not completed with an output file`);
  }
  const response = await client.files.content(batch.output_file_id);
  const outputText = await response.text();
  const outputFile = path.resolve(process.cwd(), outputArg);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, outputText, { mode: 0o600 });
  console.log(JSON.stringify({
    output: outputFile,
    bytes: Buffer.byteLength(outputText),
    sha256: sha256(outputText),
    provider_batch_id: batch.id,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
