import * as fs from 'fs';
import * as path from 'path';
import {
  LocalRequest, LocalResult, LocalStage, createLocalRequest, readJsonl,
  validateLocalRequest, validateLocalResult,
} from './protocol';
import { loadLocalModelLock, lockSha256 } from './model-lock';

const STAGE_ROLE: Record<LocalStage, string> = {
  inventory: 'inventory', english: 'english_authoring', critic: 'english_critic',
  translate: 'en_vi_translation',
};
const STAGE_PROMPT: Record<LocalStage, string> = {
  inventory: 'inventory-system.txt', english: 'english-system.txt',
  critic: 'critic-system.txt', translate: 'translation-policy.txt',
};
const STAGE_SCHEMA: Record<LocalStage, string> = {
  inventory: 'local-candidate-output.schema.json',
  english: 'local-english-entry-output.schema.json',
  critic: 'local-critic-output.schema.json',
  translate: 'local-translation-output.schema.json',
};

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string): string {
  const value = arg(name)?.trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function stageArg(): LocalStage {
  const value = required('stage') as LocalStage;
  if (!Object.prototype.hasOwnProperty.call(STAGE_ROLE, value)) throw new Error(`invalid --stage '${value}'`);
  return value;
}

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'));
}

function prepare(): void {
  const stage = stageArg();
  const output = path.resolve(process.cwd(), required('output'));
  if (fs.existsSync(output)) throw new Error(`refusing to overwrite existing request spool: ${output}`);
  const payloads = readJson(required('payloads'));
  if (!Array.isArray(payloads) || payloads.length === 0) throw new Error('--payloads must be a non-empty JSON array');
  const lock = loadLocalModelLock();
  const role = STAGE_ROLE[stage];
  const models = lock.models.filter((model) => model.roles.includes(role));
  if (models.length !== 1) throw new Error(`stage ${stage} does not resolve to one model`);
  const promptFile = path.resolve(process.cwd(), 'data/dsd/prompts/local-v1', STAGE_PROMPT[stage]);
  const schemaFile = path.resolve(process.cwd(), 'data/dsd/schemas', STAGE_SCHEMA[stage]);
  const prompt = fs.readFileSync(promptFile, 'utf8');
  const schema = readJson(schemaFile);
  const policy = readJson('data/dsd/ai/local-sampling-policy.json');
  const parameters = policy.stages[stage];
  const requests = payloads.map((payload: Record<string, unknown>, index: number) => createLocalRequest({
    stage, modelId: models[0].id, modelLockSha256: lockSha256(lock),
    promptId: `${policy.policy_id}-${stage.toUpperCase()}`, prompt, schema,
    seed: Number(payload.seed ?? index + 1), maxTokens: parameters.max_tokens,
    temperatureMilli: parameters.temperature_milli, payload,
  }));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = `${output}.partial`;
  fs.writeFileSync(temporary, requests.map((request) => JSON.stringify(request)).join('\n') + '\n', { flag: 'wx' });
  fs.renameSync(temporary, output);
  console.log(`Prepared ${requests.length} ${stage} request(s): ${output}`);
}

function validate(): void {
  const requests = readJsonl<LocalRequest>(path.resolve(process.cwd(), required('input')));
  const results = readJsonl<LocalResult>(path.resolve(process.cwd(), required('results')));
  const byId = new Map(requests.map((request) => [request.request_id, request]));
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const request of requests) errors.push(...validateLocalRequest(request).map((item) => `${request.request_id}: ${item}`));
  for (const result of results) {
    if (seen.has(result.request_id)) errors.push(`${result.request_id}: duplicate result`);
    seen.add(result.request_id);
    const request = byId.get(result.request_id);
    if (!request) errors.push(`${result.request_id}: result has no request`);
    else errors.push(...validateLocalResult(result, request).map((item) => `${result.request_id}: ${item}`));
  }
  if (errors.length) throw new Error(`Invalid local result spool:\n  - ${errors.join('\n  - ')}`);
  console.log(`Validated ${results.length}/${requests.length} result(s); pending ${requests.length - results.length}.`);
}

if (require.main === module) {
  const command = process.argv[2];
  if (command === 'prepare') prepare();
  else if (command === 'validate') validate();
  else throw new Error('usage: runner.ts <prepare|validate> ...');
}
