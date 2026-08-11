import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const DEFAULT_LOCAL_MODEL_LOCK = path.resolve(
  process.cwd(), 'data/dsd/models/local-model-lock.json',
);

export const LOCAL_MODEL_ROLES = [
  'inventory', 'english_authoring', 'candidate_critic', 'english_critic',
  'en_vi_translation',
] as const;

export interface LocalModelLockEntry {
  id: string;
  repository: string;
  revision: string;
  license: 'Apache-2.0' | 'Gemma';
  license_url: string;
  terms_evidence_id: string;
  roles: string[];
  gated: boolean;
  thinking_enabled: false;
}

export interface LocalModelLock {
  lock_version: 1;
  policy_id: string;
  runtime: {
    engine: 'mlx-lm';
    quantization_bits: 4;
    quantization_group_size: number;
    weights_source: 'official_upstream_only';
    community_quantized_artifacts_allowed: false;
  };
  models: LocalModelLockEntry[];
}

const REVISION_RE = /^[0-9a-f]{40}$/;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function lockSha256(lock: LocalModelLock): string {
  return crypto.createHash('sha256').update(canonicalJson(lock)).digest('hex');
}

export function validateLocalModelLock(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ['model lock must be an object'];
  }
  const lock = value as Partial<LocalModelLock>;
  if (lock.lock_version !== 1) errors.push('lock_version must equal 1');
  if (!lock.policy_id?.startsWith('EV-DSD-LOCAL-MODEL-POLICY-')) {
    errors.push('policy_id must identify the DSD local-model policy');
  }
  if (lock.runtime?.engine !== 'mlx-lm') errors.push("runtime.engine must be 'mlx-lm'");
  if (lock.runtime?.quantization_bits !== 4) errors.push('quantization_bits must equal 4');
  if (!Number.isInteger(lock.runtime?.quantization_group_size) ||
      Number(lock.runtime?.quantization_group_size) < 32) {
    errors.push('quantization_group_size must be an integer >= 32');
  }
  if (lock.runtime?.weights_source !== 'official_upstream_only') {
    errors.push("weights_source must be 'official_upstream_only'");
  }
  if (lock.runtime?.community_quantized_artifacts_allowed !== false) {
    errors.push('community quantized artifacts must be prohibited');
  }
  if (!Array.isArray(lock.models) || lock.models.length !== 3) {
    errors.push('models must contain exactly the three approved models');
    return errors;
  }

  const ids = new Set<string>();
  const roles = new Map<string, string>();
  for (const model of lock.models) {
    if (ids.has(model.id)) errors.push(`duplicate model id '${model.id}'`);
    ids.add(model.id);
    if (!REPOSITORY_RE.test(model.repository)) {
      errors.push(`model '${model.id}' has malformed official repository`);
    }
    if (!REVISION_RE.test(model.revision)) {
      errors.push(`model '${model.id}' must pin a 40-character commit revision`);
    }
    if (!['Apache-2.0', 'Gemma'].includes(model.license)) {
      errors.push(`model '${model.id}' has unsupported license '${model.license}'`);
    }
    if (!model.license_url?.startsWith('https://')) {
      errors.push(`model '${model.id}' has no HTTPS license URL`);
    }
    if (!model.terms_evidence_id?.trim()) {
      errors.push(`model '${model.id}' has no terms evidence ID`);
    }
    if (model.thinking_enabled !== false) {
      errors.push(`model '${model.id}' must have thinking disabled`);
    }
    if (!Array.isArray(model.roles) || model.roles.length === 0) {
      errors.push(`model '${model.id}' has no approved role`);
      continue;
    }
    for (const role of model.roles) {
      if (!(LOCAL_MODEL_ROLES as readonly string[]).includes(role)) {
        errors.push(`model '${model.id}' has unknown role '${role}'`);
      }
      const owner = roles.get(role);
      if (owner) errors.push(`role '${role}' is assigned to both '${owner}' and '${model.id}'`);
      roles.set(role, model.id);
    }
  }
  for (const role of LOCAL_MODEL_ROLES) {
    if (!roles.has(role)) errors.push(`required role '${role}' is unassigned`);
  }

  const translator = lock.models.find((model) => model.roles.includes('en_vi_translation'));
  if (translator?.license !== 'Gemma' || translator.gated !== true) {
    errors.push('TranslateGemma role must remain a gated Gemma-license exception');
  }
  for (const model of lock.models.filter((item) => !item.roles.includes('en_vi_translation'))) {
    if (model.license !== 'Apache-2.0' || model.gated) {
      errors.push(`Qwen model '${model.id}' must be non-gated Apache-2.0`);
    }
  }
  return errors;
}

export function loadLocalModelLock(file = DEFAULT_LOCAL_MODEL_LOCK): LocalModelLock {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  const errors = validateLocalModelLock(parsed);
  if (errors.length > 0) throw new Error(`Invalid local model lock:\n  - ${errors.join('\n  - ')}`);
  return parsed as LocalModelLock;
}

if (require.main === module) {
  const lock = loadLocalModelLock(process.argv[2] || DEFAULT_LOCAL_MODEL_LOCK);
  console.log(`DSD local model lock valid: ${lockSha256(lock)}`);
}
