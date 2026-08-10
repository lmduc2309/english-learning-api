/**
 * Direct OpenAI request builder and guarded client configuration for DSD.
 *
 * This module deliberately does not reuse the application's generic LLM
 * configuration, whose historical default is an OpenAI-compatible router.
 * DSD generation accepts api.openai.com only and rejects router-style model
 * identifiers before a network request is possible.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { InventoryRow, normalizeHeadword } from '../inventory';

export const DIRECT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_DSD_MODEL = 'gpt-5.6-terra';
export const DSD_GENERATOR_ACTOR = 'DSD-G-001';
export const DSD_GENERATOR_TOOL = 'openai-api-dsd-generation';
export const DSD_GENERATED_SOURCE = 'openai-dsd-generated-v1';
export const DSD_TERMS_EVIDENCE = 'EV-OPENAI-OUTPUT-TERMS-20260101';
export const DSD_PROMPT_POLICY = 'EV-DSD-AI-POLICY-20260809-001';

export const TEXT_SYSTEM_INSTRUCTIONS = `You create original English-learning dictionary content for DSD.
Work only from the supplied DSD headword, expected part of speech, and product rationale.
Do not reproduce or imitate a dictionary, corpus, source definition, or remembered reference wording.
Write one concise learner-friendly English definition from scratch.
Write a natural Vietnamese explanation of that newly written meaning.
Write one natural English example and a faithful natural Vietnamese rendering.
Use the headword naturally in the English example.
Do not mention sources, licensing, the prompt, uncertainty, or these instructions.
Return only the required structured object.`;

export interface DirectOpenAiConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  maxRequests: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxCostMicrousd: number;
}

export interface GeneratedEntryOutput {
  headword: string;
  sense_key: 's1';
  part_of_speech: string;
  definition_en: string;
  translation_vi: string;
  example_en: string;
  example_vi: string;
  usage_labels: string[];
}

export interface BatchRequestLine {
  custom_id: string;
  method: 'POST';
  url: '/v1/responses';
  body: Record<string, unknown>;
}

export interface PreparedBatchManifest {
  manifest_version: 1;
  batch_id: string;
  target_id: string;
  provider_id: 'openai';
  endpoint: '/v1/responses';
  requested_model: string;
  request_count: number;
  prompt_sha256: string;
  schema_sha256: string;
  input_sha256: string;
  jsonl_sha256: string;
  legacy_input_used: false;
}

function positiveInteger(name: string, value: string | undefined, fallback: number): number {
  const parsed = value == null || value.trim() === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}

export function loadDirectOpenAiConfig(
  env: NodeJS.ProcessEnv = process.env,
  requireKey = true,
): DirectOpenAiConfig {
  const baseURL = (env.DSD_OPENAI_BASE_URL ?? DIRECT_OPENAI_BASE_URL).replace(/\/+$/, '');
  if (baseURL !== DIRECT_OPENAI_BASE_URL) {
    throw new Error(
      `DSD_OPENAI_BASE_URL must be exactly ${DIRECT_OPENAI_BASE_URL}; ` +
      'OpenRouter and compatible proxy endpoints are prohibited',
    );
  }

  const model = (env.DSD_OPENAI_MODEL ?? DEFAULT_DSD_MODEL).trim();
  if (!model || model.includes('/') || model.includes(':')) {
    throw new Error(
      `DSD_OPENAI_MODEL '${model}' is invalid; router-style provider/model IDs are prohibited`,
    );
  }

  const apiKey = (env.OPENAI_API_KEY ?? '').trim();
  if (requireKey && !apiKey) {
    throw new Error(
      'OPENAI_API_KEY is required for a direct OpenAI operation; ' +
      'LLM_API_KEY and OPENROUTER_API_KEY are never accepted by DSD generation',
    );
  }

  return {
    apiKey,
    baseURL,
    model,
    maxRequests: positiveInteger('DSD_AI_MAX_REQUESTS', env.DSD_AI_MAX_REQUESTS, 50),
    maxInputTokens: positiveInteger('DSD_AI_MAX_INPUT_TOKENS', env.DSD_AI_MAX_INPUT_TOKENS, 100_000),
    maxOutputTokens: positiveInteger('DSD_AI_MAX_OUTPUT_TOKENS', env.DSD_AI_MAX_OUTPUT_TOKENS, 50_000),
    maxCostMicrousd: positiveInteger('DSD_AI_MAX_COST_MICROUSD', env.DSD_AI_MAX_COST_MICROUSD, 50_000_000),
  };
}

export function createDirectOpenAiClient(config: DirectOpenAiConfig): OpenAI {
  if (!config.apiKey) throw new Error('Cannot create direct OpenAI client without OPENAI_API_KEY');
  return new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
}

export function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function loadEntryOutputSchema(
  file = path.resolve(process.cwd(), 'data/dsd/schemas/ai-entry-output.schema.json'),
): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
}

export function buildEntryInput(row: InventoryRow): string {
  return [
    `DSD headword: ${normalizeHeadword(row.headword).headword}`,
    `Expected part of speech: ${row.part_of_speech_expectation}`,
    `Product rationale: ${row.product_rationale}`,
  ].join('\n');
}

export function buildResponseBody(
  row: InventoryRow,
  model: string,
  schema: Record<string, unknown>,
): Record<string, unknown> {
  return {
    model,
    instructions: TEXT_SYSTEM_INSTRUCTIONS,
    input: buildEntryInput(row),
    max_output_tokens: 700,
    store: false,
    text: {
      format: {
        type: 'json_schema',
        name: 'dsd_learner_entry',
        strict: true,
        schema,
      },
    },
    metadata: {
      dsd_entry_id: row.dsd_entry_id,
      dsd_batch_actor: DSD_GENERATOR_ACTOR,
      legacy_input_used: 'false',
    },
  };
}

export function buildBatchRequestLine(
  row: InventoryRow,
  model: string,
  schema: Record<string, unknown>,
): BatchRequestLine {
  return {
    custom_id: `dsd-${row.dsd_entry_id}`,
    method: 'POST',
    url: '/v1/responses',
    body: buildResponseBody(row, model, schema),
  };
}

const OUTPUT_KEYS = [
  'headword', 'sense_key', 'part_of_speech', 'definition_en', 'translation_vi',
  'example_en', 'example_vi', 'usage_labels',
];

export function validateGeneratedEntry(output: unknown, row: InventoryRow): string[] {
  const errors: string[] = [];
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return ['output must be an object'];
  }
  const value = output as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (!OUTPUT_KEYS.includes(key)) errors.push(`unknown output field '${key}'`);
  }
  for (const key of OUTPUT_KEYS) {
    if (!(key in value)) errors.push(`missing output field '${key}'`);
  }

  const expectedHeadword = normalizeHeadword(row.headword).headwordNormalized;
  const actualHeadword = normalizeHeadword(String(value.headword ?? '')).headwordNormalized;
  if (actualHeadword !== expectedHeadword) {
    errors.push(`headword '${value.headword}' does not match inventory '${row.headword}'`);
  }
  if (value.sense_key !== 's1') errors.push("sense_key must be 's1'");
  if (value.part_of_speech !== row.part_of_speech_expectation) {
    errors.push(
      `part_of_speech '${value.part_of_speech}' does not match expected ` +
      `'${row.part_of_speech_expectation}'`,
    );
  }

  for (const [key, min, max] of [
    ['definition_en', 8, 320],
    ['translation_vi', 1, 320],
    ['example_en', 8, 320],
    ['example_vi', 8, 320],
  ] as Array<[string, number, number]>) {
    const text = typeof value[key] === 'string' ? value[key].trim() : '';
    if (text.length < min || text.length > max) {
      errors.push(`${key} length must be ${min}..${max}`);
    }
  }
  if (!Array.isArray(value.usage_labels) || value.usage_labels.length > 4) {
    errors.push('usage_labels must be an array with at most 4 items');
  }
  return errors;
}
