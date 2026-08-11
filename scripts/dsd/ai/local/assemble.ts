import * as fs from 'fs';
import * as path from 'path';
import { CurationPackage } from '../../curation';
import { canonicalJson } from './model-lock';
import { LocalRequest, LocalResult, readJsonl, sha256, validateLocalResult } from './protocol';
import { loadSelectionManifest } from './selection';

export interface CompletedLocal {
  request: LocalRequest;
  result: LocalResult;
}

export interface AssembleInput {
  english: CompletedLocal[];
  critics: CompletedLocal[];
  translations: CompletedLocal[];
  batchId: string;
  declarationId: string;
  generatedAt: string;
}

function entryId(value: CompletedLocal): string {
  return String(value.request.payload.dsd_entry_id ?? '');
}

function selectedByEntry(base: CompletedLocal[], repairs: CompletedLocal[]): CompletedLocal[] {
  const selected = new Map(base.map((value) => [entryId(value), value]));
  for (const repair of repairs) selected.set(entryId(repair), repair);
  return [...selected.values()].sort((a, b) => entryId(a).localeCompare(entryId(b)));
}

export function assembleLocalPackage(input: AssembleInput): CurationPackage {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(input.generatedAt)) {
    throw new Error('generatedAt must be UTC ISO 8601 seconds');
  }
  const critics = new Map(input.critics.map((value) => [entryId(value), value]));
  const translations = new Map<string, CompletedLocal>();
  for (const value of input.translations) {
    const field = String(value.request.payload.field ?? '');
    const key = `${entryId(value)}:${field}`;
    if (translations.has(key)) throw new Error(`${key}: duplicate translation`);
    translations.set(key, value);
  }
  const entries = input.english.map((value) => {
    const id = entryId(value);
    const critic = critics.get(id);
    if (!critic || (critic.result.output as any).decision !== 'pass') {
      throw new Error(`${id}: selected English revision lacks a passing critic`);
    }
    const output = value.result.output as any;
    const expectedPos = value.request.payload.expected_part_of_speech;
    if (output.headword !== value.request.payload.headword ||
        (expectedPos !== 'infer' && output.part_of_speech !== expectedPos)) {
      throw new Error(`${id}: English output does not echo its inventory identity`);
    }
    const definition = translations.get(`${id}:definition_en`);
    const example = translations.get(`${id}:example_en`);
    if (!definition || !example) throw new Error(`${id}: requires definition and example translations`);
    if (definition.request.payload.text !== output.definition_en ||
        example.request.payload.text !== output.example_en) {
      throw new Error(`${id}: translation source is not the selected English revision`);
    }
    const actor = 'DSD-G-002';
    const source = 'dsd-local-mlx-generated-v1';
    const rights = 'EV-DSD-LOCAL-PIPELINE-OUTPUT-RIGHTS-20260811';
    return {
      dsd_entry_id: id,
      headword: output.headword,
      product_rationale: String(value.request.payload.product_rationale ?? ''),
      senses: [{
        sense_key: 's1', sense_order: 1, part_of_speech: output.part_of_speech,
        definition_en: output.definition_en, usage_labels: output.usage_labels,
        authored_by: actor, source_id: source, rights_evidence_id: rights,
        translation: { locale: 'vi', text: (definition.result.output as any).translation_vi,
          authored_by: actor, source_id: source, rights_evidence_id: rights },
        examples: [{ example_order: 1, en: output.example_en,
          vi: (example.result.output as any).translation_vi,
          authored_by: actor, source_id: source, rights_evidence_id: rights }],
      }],
    };
  });
  const evidence = [...input.english, ...input.critics, ...input.translations].map(({ request, result }) => ({
    request_id: request.request_id, input_sha256: request.input_sha256,
    output_sha256: result.output_sha256,
  }));
  return {
    package_version: 1, batch_id: input.batchId, declaration_id: input.declarationId,
    generation: {
      generator_actor_id: 'DSD-G-002', generator_tool_id: 'dsd-local-mlx-text-pipeline-v1',
      generator_tool_revision: 'local-model-lock-a4139af9f833ec8b9998ceb86438b9be9a7a599964358883203932e9bd3546d8',
      generated_source_id: 'dsd-local-mlx-generated-v1', provider_id: 'local',
      product_id: 'mlx-lm', runtime_model_id: 'dsd-local-three-model-lock-a4139af9',
      generated_at: input.generatedAt, prompt_policy_id: 'EV-DSD-LOCAL-MODEL-POLICY-20260811-001',
      input_sha256: sha256(canonicalJson(evidence)),
      terms_evidence_id: 'EV-DSD-LOCAL-PIPELINE-OUTPUT-RIGHTS-20260811', legacy_input_used: false,
    },
    entries,
  };
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string): string {
  const value = arg(name)?.trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function load(inputFile: string, resultFile: string, excludedEntryIds = new Set<string>()): CompletedLocal[] {
  const requests = readJsonl<LocalRequest>(path.resolve(process.cwd(), inputFile));
  const requestMap = new Map(requests.map((value) => [value.request_id, value]));
  const values = readJsonl<LocalResult>(path.resolve(process.cwd(), resultFile)).map((result) => {
    const request = requestMap.get(result.request_id);
    if (!request) throw new Error(`${result.request_id}: result has no request`);
    if (excludedEntryIds.has(entryId({ request, result }))) return undefined;
    const errors = validateLocalResult(result, request);
    if (errors.length || result.state !== 'completed') throw new Error(`${result.request_id}: ${errors.join('; ')}`);
    return { request, result };
  }).filter((value): value is CompletedLocal => Boolean(value));
  if (values.length + excludedEntryIds.size !== requests.length) {
    throw new Error(`${resultFile}: incomplete result spool or excluded entry mismatch`);
  }
  return values;
}

function main(): void {
  const selectionFile = arg('selection');
  if (selectionFile) {
    const selected = loadSelectionManifest(selectionFile);
    const pkg = assembleLocalPackage({
      english: selected.passedEnglish, critics: selected.critics,
      translations: load(required('translation-input'), required('translation-results')),
      batchId: required('batch-id'), declarationId: required('declaration-id'),
      generatedAt: required('generated-at'),
    });
    const output = path.resolve(process.cwd(), required('output'));
    if (fs.existsSync(output)) throw new Error(`refusing to overwrite: ${output}`);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(pkg, null, 2) + '\n', { flag: 'wx' });
    console.log(`Assembled ${pkg.entries.length} draft entry package: ${output}`);
    return;
  }
  const repairInput = arg('repair-input');
  const repairResults = arg('repair-results');
  const repairCriticInput = arg('repair-critic-input');
  const repairCriticResults = arg('repair-critic-results');
  const repairArgs = [repairInput, repairResults, repairCriticInput, repairCriticResults];
  if (repairArgs.some(Boolean) && !repairArgs.every(Boolean)) throw new Error('all repair spool arguments are required');
  const repairs = repairInput ? load(repairInput, repairResults!) : [];
  const repairedIds = new Set(repairs.map(entryId));
  const base = load(required('english-input'), required('english-results'), repairedIds);
  const critics = load(required('critic-input'), required('critic-results'), repairedIds);
  const repairCritics = repairCriticInput ? load(repairCriticInput, repairCriticResults!) : [];
  const pkg = assembleLocalPackage({
    english: selectedByEntry(base, repairs), critics: selectedByEntry(critics, repairCritics),
    translations: load(required('translation-input'), required('translation-results')),
    batchId: required('batch-id'), declarationId: required('declaration-id'),
    generatedAt: required('generated-at'),
  });
  const output = path.resolve(process.cwd(), required('output'));
  if (fs.existsSync(output)) throw new Error(`refusing to overwrite: ${output}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(pkg, null, 2) + '\n', { flag: 'wx' });
  console.log(`Assembled ${pkg.entries.length} draft entry package: ${output}`);
}

if (require.main === module) main();
