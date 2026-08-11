import * as crypto from 'crypto';
import * as fs from 'fs';
import { canonicalJson } from './model-lock';

export const LOCAL_STAGES = ['inventory', 'english', 'critic', 'translate'] as const;
export type LocalStage = (typeof LOCAL_STAGES)[number];
export const LOCAL_TERMINAL_STATES = [
  'completed', 'schema_invalid', 'quality_invalid', 'quarantined', 'terminal_failure',
] as const;

const SHA_RE = /^[0-9a-f]{64}$/;
const FORBIDDEN_KEY_RE = /(?:^|_)(?:legacy|reviewer|approved|published|similarity|reasoning)(?:_|$)/i;

export interface LocalRequest {
  protocol_version: 1;
  request_id: string;
  stage: LocalStage;
  model_id: string;
  model_lock_sha256: string;
  prompt_id: string;
  prompt_sha256: string;
  schema_sha256: string;
  input_sha256: string;
  seed: number;
  parameters: { max_tokens: number; temperature_milli: number };
  payload: Record<string, unknown>;
}

export interface LocalResult {
  protocol_version: 1;
  request_id: string;
  state: (typeof LOCAL_TERMINAL_STATES)[number];
  model_id: string;
  model_lock_sha256: string;
  prompt_sha256: string;
  schema_sha256: string;
  input_sha256: string;
  output_sha256?: string;
  output?: unknown;
  input_tokens: number;
  output_tokens: number;
  elapsed_ms: number;
  error_code?: string;
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function findForbiddenKeys(value: unknown, prefix = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findForbiddenKeys(item, `${prefix}[${index}]`));
  }
  if (!value || typeof value !== 'object') return [];
  const errors: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = `${prefix}.${key}`;
    if (FORBIDDEN_KEY_RE.test(key)) errors.push(next);
    errors.push(...findForbiddenKeys(child, next));
  }
  return errors;
}

export function createLocalRequest(input: {
  stage: LocalStage;
  modelId: string;
  modelLockSha256: string;
  promptId: string;
  prompt: string;
  schema: unknown;
  seed: number;
  maxTokens: number;
  temperatureMilli: number;
  payload: Record<string, unknown>;
}): LocalRequest {
  if (!(LOCAL_STAGES as readonly string[]).includes(input.stage)) throw new Error('unknown local stage');
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) throw new Error('seed must be a non-negative integer');
  if (!Number.isSafeInteger(input.maxTokens) || input.maxTokens <= 0) throw new Error('maxTokens must be positive');
  if (!Number.isSafeInteger(input.temperatureMilli) || input.temperatureMilli < 0 || input.temperatureMilli > 2000) {
    throw new Error('temperatureMilli must be an integer from 0 to 2000');
  }
  const forbidden = findForbiddenKeys(input.payload);
  if (forbidden.length > 0) throw new Error(`forbidden local-model input field(s): ${forbidden.join(', ')}`);
  const promptSha = sha256(input.prompt);
  const schemaSha = sha256(canonicalJson(input.schema));
  const inputSha = sha256(canonicalJson(input.payload));
  const identity = canonicalJson({
    stage: input.stage, model_id: input.modelId, model_lock_sha256: input.modelLockSha256,
    prompt_sha256: promptSha, schema_sha256: schemaSha, input_sha256: inputSha,
    seed: input.seed, max_tokens: input.maxTokens, temperature_milli: input.temperatureMilli,
  });
  return {
    protocol_version: 1,
    request_id: `dsd-local-${sha256(identity)}`,
    stage: input.stage,
    model_id: input.modelId,
    model_lock_sha256: input.modelLockSha256,
    prompt_id: input.promptId,
    prompt_sha256: promptSha,
    schema_sha256: schemaSha,
    input_sha256: inputSha,
    seed: input.seed,
    parameters: { max_tokens: input.maxTokens, temperature_milli: input.temperatureMilli },
    payload: input.payload,
  };
}

export function validateLocalRequest(request: LocalRequest): string[] {
  const errors: string[] = [];
  if (request.protocol_version !== 1) errors.push('protocol_version must equal 1');
  if (!(LOCAL_STAGES as readonly string[]).includes(request.stage)) errors.push('invalid stage');
  if (!/^dsd-local-[0-9a-f]{64}$/.test(request.request_id)) errors.push('invalid request_id');
  for (const [name, value] of [
    ['model_lock_sha256', request.model_lock_sha256], ['prompt_sha256', request.prompt_sha256],
    ['schema_sha256', request.schema_sha256], ['input_sha256', request.input_sha256],
  ]) if (!SHA_RE.test(value)) errors.push(`${name} must be SHA-256`);
  const forbidden = findForbiddenKeys(request.payload);
  if (forbidden.length) errors.push(`forbidden payload fields: ${forbidden.join(', ')}`);
  if (sha256(canonicalJson(request.payload)) !== request.input_sha256) errors.push('payload hash mismatch');
  return errors;
}

export function validateLocalResult(result: LocalResult, request: LocalRequest): string[] {
  const errors: string[] = [];
  for (const field of [
    'request_id', 'model_id', 'model_lock_sha256', 'prompt_sha256', 'schema_sha256', 'input_sha256',
  ] as const) {
    if (result[field] !== request[field]) errors.push(`${field} does not match request`);
  }
  if (!(LOCAL_TERMINAL_STATES as readonly string[]).includes(result.state)) errors.push('invalid result state');
  for (const field of ['input_tokens', 'output_tokens', 'elapsed_ms'] as const) {
    if (!Number.isSafeInteger(result[field]) || result[field] < 0) errors.push(`${field} must be non-negative integer`);
  }
  if (result.state === 'completed') {
    if (result.output === undefined || !result.output_sha256) errors.push('completed result requires output and hash');
    else if (sha256(canonicalJson(result.output)) !== result.output_sha256) errors.push('output hash mismatch');
    errors.push(...validateStageOutput(request.stage, result.output));
    if (result.error_code) errors.push('completed result cannot contain error_code');
  } else if (!result.error_code) errors.push('failed result requires error_code');
  return errors;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

export function validateStageOutput(stage: LocalStage, output: unknown): string[] {
  if (!plainObject(output)) return [`${stage} output must be an object`];
  if (stage === 'translate') {
    if (!exactKeys(output, ['translation_vi'])) return ['translate output must contain only translation_vi'];
    const text = typeof output.translation_vi === 'string' ? output.translation_vi.trim() : '';
    return text.length >= 1 && text.length <= 320 ? [] : ['translation_vi length must be 1..320'];
  }
  if (stage === 'critic') {
    const errors: string[] = [];
    if (!exactKeys(output, ['decision', 'reason_codes'])) errors.push('critic output has incorrect keys');
    if (!['pass', 'repair', 'quarantine'].includes(String(output.decision))) errors.push('critic decision is invalid');
    if (!Array.isArray(output.reason_codes) || output.reason_codes.length > 8 ||
        output.reason_codes.some((code) => typeof code !== 'string' || !/^[A-Z][A-Z0-9_]{2,47}$/.test(code))) {
      errors.push('critic reason_codes are invalid');
    }
    return errors;
  }
  if (stage === 'english') {
    const keys = ['headword', 'part_of_speech', 'definition_en', 'example_en', 'usage_labels'];
    const errors: string[] = [];
    if (!exactKeys(output, keys)) errors.push('english output has incorrect keys');
    for (const [field, min, max] of [
      ['headword', 1, 120], ['part_of_speech', 2, 32], ['definition_en', 8, 320], ['example_en', 8, 320],
    ] as Array<[string, number, number]>) {
      const text = typeof output[field] === 'string' ? String(output[field]).trim() : '';
      if (text.length < min || text.length > max) errors.push(`${field} length must be ${min}..${max}`);
    }
    if (!Array.isArray(output.usage_labels) || output.usage_labels.length > 4 ||
        output.usage_labels.some((label) => typeof label !== 'string' || !label.trim())) {
      errors.push('usage_labels are invalid');
    }
    return errors;
  }
  if (!exactKeys(output, ['candidates']) || !Array.isArray(output.candidates) ||
      output.candidates.length < 1 || output.candidates.length > 100) {
    return ['inventory output requires 1..100 candidates only'];
  }
  const errors: string[] = [];
  output.candidates.forEach((candidate, index) => {
    if (!plainObject(candidate) || !exactKeys(candidate, ['headword', 'part_of_speech', 'rationale'])) {
      errors.push(`candidate ${index} has incorrect shape`);
      return;
    }
    for (const [field, min, max] of [
      ['headword', 1, 120], ['part_of_speech', 2, 32], ['rationale', 8, 240],
    ] as Array<[string, number, number]>) {
      const text = typeof candidate[field] === 'string' ? String(candidate[field]).trim() : '';
      if (text.length < min || text.length > max) errors.push(`candidate ${index} ${field} is invalid`);
    }
  });
  return errors;
}

export function readJsonl<T>(file: string): T[] {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line) as T; } catch { throw new Error(`${file}:${index + 1}: invalid JSON`); }
  });
}
