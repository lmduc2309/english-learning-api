import * as childProcess from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { LocalRequest, LocalResult, LocalStage, readJsonl, sha256, validateLocalResult } from './protocol';
import { canonicalJson } from './model-lock';

type Step = 'prepared' | 'english' | 'critic' | 'repairs' | 'translate' | 'validated' | 'packaged';

export interface FullRunState {
  version: 1;
  run_id: string;
  wave_id: string;
  target: number;
  inventory: string;
  max_repairs: number;
  step: Step;
  paused: boolean;
  created_at: string;
  updated_at: string;
  counts: { requested: number; passed: number; repair: number; quarantined: number; packaged: number };
}

const ROOT = process.cwd();
const DEFAULT_RUNS = 'data/dsd/runs';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string): string {
  const value = arg(name)?.trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function positiveInteger(name: string, fallback?: number): number {
  const raw = arg(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`--${name} must be a positive integer`);
  return Number(value);
}

function safeId(value: string, label: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)) throw new Error(`invalid ${label}`);
  return value;
}

function runDir(wave?: string): string {
  return path.resolve(ROOT, arg('runs-dir') ?? DEFAULT_RUNS, safeId(wave ?? required('wave'), 'wave id'));
}

function stateFile(dir: string): string { return path.join(dir, 'state.json'); }

function atomicJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.partial`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(temporary, file);
}

function loadState(dir: string): FullRunState {
  const state = JSON.parse(fs.readFileSync(stateFile(dir), 'utf8')) as FullRunState;
  if (state.version !== 1) throw new Error('unsupported full-run state version');
  return state;
}

function saveState(dir: string, state: FullRunState): void {
  state.updated_at = new Date().toISOString();
  const file = stateFile(dir);
  const temporary = `${file}.partial`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(temporary, file);
}

function execute(script: string, args: string[], env = process.env): void {
  const bin = script.endsWith('.py') ? path.resolve(ROOT, '.venv-dsd-local/bin/python') : process.execPath;
  const commandArgs = script.endsWith('.py')
    ? [path.resolve(ROOT, script), ...args]
    : [require.resolve('ts-node/dist/bin.js'), path.resolve(ROOT, script), ...args];
  const result = childProcess.spawnSync(bin, commandArgs, { cwd: ROOT, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(script)} failed with exit ${result.status}`);
}

function calibration(args: string[]): void { execute('scripts/dsd/ai/local/calibration.ts', args); }
function runner(args: string[]): void { execute('scripts/dsd/ai/local/runner.ts', args); }

function paths(dir: string) {
  return {
    englishPayloads: path.join(dir, 'english.payloads.json'), englishInput: path.join(dir, 'english.requests.jsonl'),
    englishResults: path.join(dir, 'english.results.jsonl'), criticPayloads: path.join(dir, 'critic.payloads.json'),
    criticInput: path.join(dir, 'critic.requests.jsonl'), criticResults: path.join(dir, 'critic.results.jsonl'),
    selection: path.join(dir, 'selection.json'), translationPayloads: path.join(dir, 'translate.payloads.json'),
    translationInput: path.join(dir, 'translate.requests.jsonl'), translationResults: path.join(dir, 'translate.results.jsonl'),
    report: path.join(dir, 'quality-report.json'), package: path.join(dir, 'draft-package.json'),
  };
}

function prepare(): void {
  const wave = safeId(required('wave'), 'wave id');
  const dir = runDir(wave);
  if (fs.existsSync(stateFile(dir))) throw new Error(`wave already exists: ${dir}`);
  const inventory = path.resolve(ROOT, required('inventory'));
  const target = positiveInteger('target');
  const maxRepairs = positiveInteger('max-repairs', 2);
  const p = paths(dir);
  calibration(['prepare-english', '--inventory', inventory, '--limit', String(target), '--output', p.englishPayloads]);
  runner(['prepare', '--stage', 'english', '--payloads', p.englishPayloads, '--output', p.englishInput]);
  const now = new Date().toISOString();
  atomicJson(stateFile(dir), {
    version: 1, run_id: crypto.randomUUID(), wave_id: wave, target, inventory,
    max_repairs: maxRepairs, step: 'prepared', paused: false, created_at: now, updated_at: now,
    counts: { requested: target, passed: 0, repair: 0, quarantined: 0, packaged: 0 },
  } satisfies FullRunState);
  console.log(`Prepared offline wave ${wave}: ${target} entries in ${dir}`);
}

function inferFile(stage: LocalStage, input: string, output: string): void {
  if (!process.env.DSD_LOCAL_MODEL_HOME?.trim()) throw new Error('DSD_LOCAL_MODEL_HOME is required');
  execute('scripts/dsd/ai/local/worker.py', ['--stage', stage, '--input', input, '--output', output]);
  runner(['validate', '--stage', stage, '--input', input, '--results', output]);
}

function prepareAndInferCritic(p: ReturnType<typeof paths>, state: FullRunState): void {
  calibration(['prepare-critic', '--input', p.englishInput, '--results', p.englishResults, '--output', p.criticPayloads]);
  runner(['prepare', '--stage', 'critic', '--payloads', p.criticPayloads, '--output', p.criticInput]);
  inferFile('critic', p.criticInput, p.criticResults);
  state.step = 'critic';
}

function decisions(input: string, results: string): Map<string, string> {
  const requests = new Map(readJsonl<LocalRequest>(input).map((value) => [value.request_id, value]));
  const output = new Map<string, string>();
  for (const result of readJsonl<LocalResult>(results)) {
    const request = requests.get(result.request_id);
    if (!request) throw new Error(`${result.request_id}: missing request`);
    const errors = validateLocalResult(result, request);
    if (errors.length || result.state !== 'completed') throw new Error(`${result.request_id}: ${errors.join('; ') || result.state}`);
    output.set(String(request.payload.dsd_entry_id), String((result.output as any).decision));
  }
  return output;
}

function repair(dir: string, p: ReturnType<typeof paths>, state: FullRunState): Array<{ input: string; results: string }> {
  const refs: Array<{ input: string; results: string }> = [];
  let criticInput = p.criticInput;
  let criticResults = p.criticResults;
  for (let revision = 1; revision <= state.max_repairs; revision += 1) {
    const current = decisions(criticInput, criticResults);
    if (![...current.values()].includes('repair')) break;
    const stem = path.join(dir, `repair-${revision}`);
    const payloads = `${stem}.payloads.json`; const input = `${stem}.requests.jsonl`; const results = `${stem}.results.jsonl`;
    const criticPayloads = `${stem}.critic.payloads.json`; const nextCriticInput = `${stem}.critic.requests.jsonl`;
    const nextCriticResults = `${stem}.critic.results.jsonl`;
    calibration(['prepare-repairs', '--inventory', state.inventory, '--critic-input', criticInput,
      '--critic-results', criticResults, '--revision', String(revision), '--output', payloads]);
    runner(['prepare', '--stage', 'english', '--payloads', payloads, '--output', input]);
    inferFile('english', input, results);
    calibration(['prepare-critic', '--input', input, '--results', results, '--output', criticPayloads]);
    runner(['prepare', '--stage', 'critic', '--payloads', criticPayloads, '--output', nextCriticInput]);
    inferFile('critic', nextCriticInput, nextCriticResults);
    refs.push({ input, results }, { input: nextCriticInput, results: nextCriticResults });
    criticInput = nextCriticInput; criticResults = nextCriticResults;
  }
  state.step = 'repairs';
  return refs;
}

function writeSelection(p: ReturnType<typeof paths>, repairRefs: Array<{ input: string; results: string }>): void {
  const english = [{ input: p.englishInput, results: p.englishResults }];
  const critics = [{ input: p.criticInput, results: p.criticResults }];
  repairRefs.forEach((ref, index) => (index % 2 === 0 ? english : critics).push(ref));
  atomicJson(p.selection, { version: 1, english, critics });
}

function summarizeSelection(p: ReturnType<typeof paths>, state: FullRunState): void {
  const manifest = JSON.parse(fs.readFileSync(p.selection, 'utf8')) as any;
  const latest = new Map<string, string>();
  for (const ref of manifest.critics) {
    for (const [id, decision] of decisions(ref.input, ref.results)) latest.set(id, decision);
  }
  state.counts.passed = [...latest.values()].filter((value) => value === 'pass').length;
  state.counts.repair = [...latest.values()].filter((value) => value === 'repair').length;
  state.counts.quarantined = [...latest.values()].filter((value) => value !== 'pass').length;
}

function infer(stage?: LocalStage): void {
  const dir = runDir(); const state = loadState(dir); const p = paths(dir);
  if (state.paused) throw new Error('wave is paused');
  const requested = stage ?? (state.step === 'prepared' ? 'english' : state.step === 'english' ? 'critic' : undefined);
  if (requested === 'english') { inferFile('english', p.englishInput, p.englishResults); state.step = 'english'; }
  else if (requested === 'critic') prepareAndInferCritic(p, state);
  else if (requested === 'translate') {
    calibration(['prepare-translations', '--selection', p.selection, '--output', p.translationPayloads]);
    runner(['prepare', '--stage', 'translate', '--payloads', p.translationPayloads, '--output', p.translationInput]);
    inferFile('translate', p.translationInput, p.translationResults); state.step = 'translate';
  } else throw new Error('infer stage must be english, critic, or translate for a prepared content wave');
  saveState(dir, state);
}

function validateWave(dir: string, state: FullRunState): void {
  const p = paths(dir);
  for (const [stage, input, output] of [
    ['english', p.englishInput, p.englishResults], ['critic', p.criticInput, p.criticResults],
    ['translate', p.translationInput, p.translationResults],
  ] as Array<[LocalStage, string, string]>) runner(['validate', '--stage', stage, '--input', input, '--results', output]);
  calibration(['report', '--selection', p.selection,
    '--translation-input', p.translationInput, '--translation-results', p.translationResults, '--output', p.report]);
  const report = JSON.parse(fs.readFileSync(p.report, 'utf8'));
  if (report.translation.deterministic_quality_fail !== 0) throw new Error('Vietnamese deterministic quality gate failed');
  state.step = 'validated'; saveState(dir, state);
}

function packageWave(dir: string, state: FullRunState): void {
  const p = paths(dir);
  execute('scripts/dsd/ai/local/assemble.ts', ['--selection', p.selection, '--translation-input', p.translationInput,
    '--translation-results', p.translationResults, '--batch-id', `DSD-LOCAL-${state.wave_id.toUpperCase()}`,
    '--declaration-id', 'EV-DSD-CLEAN-ROOM-LOCAL-W0-20260811', '--generated-at', new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    '--output', p.package]);
  const pkg = JSON.parse(fs.readFileSync(p.package, 'utf8'));
  state.counts.packaged = pkg.entries.length; state.step = 'packaged'; saveState(dir, state);
}

function autoRun(): void {
  const wave = required('wave'); const dir = runDir(wave);
  if (!fs.existsSync(stateFile(dir))) prepare();
  const state = loadState(dir); const p = paths(dir);
  if (state.paused) throw new Error('wave is paused');
  if (state.step === 'prepared') { inferFile('english', p.englishInput, p.englishResults); state.step = 'english'; saveState(dir, state); }
  if (state.step === 'english') { prepareAndInferCritic(p, state); saveState(dir, state); }
  if (state.step === 'critic') { const refs = repair(dir, p, state); writeSelection(p, refs); summarizeSelection(p, state); saveState(dir, state); }
  if (state.step === 'repairs') {
    calibration(['prepare-translations', '--selection', p.selection, '--output', p.translationPayloads]);
    runner(['prepare', '--stage', 'translate', '--payloads', p.translationPayloads, '--output', p.translationInput]);
    inferFile('translate', p.translationInput, p.translationResults); state.step = 'translate'; saveState(dir, state);
  }
  if (state.step === 'translate') validateWave(dir, state);
  if (state.step === 'validated') packageWave(dir, state);
  console.log(JSON.stringify(loadState(dir), null, 2));
}

function status(): void {
  const base = path.resolve(ROOT, arg('runs-dir') ?? DEFAULT_RUNS);
  const wave = arg('wave');
  const files = wave ? [stateFile(runDir(wave))] : (fs.existsSync(base) ? fs.readdirSync(base).map((name) => stateFile(path.join(base, name))).filter(fs.existsSync) : []);
  console.log(JSON.stringify(files.map((file) => loadState(path.dirname(file))), null, 2));
}

function pause(): void { const dir = runDir(); const state = loadState(dir); state.paused = true; saveState(dir, state); console.log(`Paused ${state.wave_id}`); }

function stage(): void {
  const dir = runDir(); const state = loadState(dir);
  if (state.step !== 'packaged') throw new Error('offline draft package is incomplete');
  const requiredProofs = ['backup-manifest', 'offhost-proof', 'restore-proof', 'authorization'];
  const missing = requiredProofs.filter((name) => !arg(name) || !fs.existsSync(path.resolve(ROOT, arg(name)!)));
  if (missing.length) throw new Error(`production staging blocked; missing proof(s): ${missing.join(', ')}`);
  throw new Error('production staging is intentionally not automatic; run the transactional curation dry-run/import workflow after proof review');
}

function fill(): void {
  const dir = runDir(); const state = loadState(dir); const p = paths(dir);
  if (state.step !== 'packaged') throw new Error('base offline draft package is incomplete');
  const target = positiveInteger('target', state.target);
  const reserveFile = path.resolve(ROOT, required('reserve-package'));
  const headword = required('headword').normalize('NFC').trim().toLocaleLowerCase();
  const base = JSON.parse(fs.readFileSync(p.package, 'utf8')) as any;
  const reserve = JSON.parse(fs.readFileSync(reserveFile, 'utf8')) as any;
  const candidates = reserve.entries.filter((entry: any) => String(entry.headword).normalize('NFC').trim().toLocaleLowerCase() === headword);
  if (candidates.length !== 1) throw new Error(`reserve package must contain exactly one '${headword}' entry`);
  const existingIds = new Set(base.entries.map((entry: any) => entry.dsd_entry_id));
  const existingHeadwords = new Set(base.entries.map((entry: any) => String(entry.headword).normalize('NFC').trim().toLocaleLowerCase()));
  if (existingIds.has(candidates[0].dsd_entry_id) || existingHeadwords.has(headword)) throw new Error('reserve duplicates the base package');
  if (base.entries.length + 1 !== target) throw new Error(`one reserve would produce ${base.entries.length + 1}, not target ${target}`);
  for (const field of ['generator_actor_id', 'generator_tool_id', 'generator_tool_revision', 'generated_source_id',
    'provider_id', 'product_id', 'runtime_model_id', 'prompt_policy_id', 'terms_evidence_id', 'legacy_input_used']) {
    if (base.generation?.[field] !== reserve.generation?.[field]) throw new Error(`incompatible reserve generation field ${field}`);
  }
  const output = path.join(dir, 'draft-package-final.json');
  if (fs.existsSync(output)) throw new Error(`refusing to overwrite: ${output}`);
  const merged = {
    ...base,
    batch_id: `${base.batch_id}-FINAL-${target}`,
    generation: {
      ...base.generation,
      generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      input_sha256: sha256(canonicalJson([
        { package: path.basename(p.package), input_sha256: base.generation.input_sha256 },
        { package: path.basename(reserveFile), input_sha256: reserve.generation.input_sha256,
          selected_entry_id: candidates[0].dsd_entry_id },
      ])),
    },
    entries: [...base.entries, candidates[0]].sort((a: any, b: any) => a.dsd_entry_id.localeCompare(b.dsd_entry_id)),
  };
  atomicJson(output, merged);
  state.counts.packaged = merged.entries.length; saveState(dir, state);
  console.log(`Filled wave ${state.wave_id} to ${merged.entries.length}/${target}: ${output}`);
}

if (require.main === module) {
  try {
    const command = process.argv[2];
    if (command === 'prepare') prepare();
    else if (command === 'infer') infer(arg('stage') as LocalStage | undefined);
    else if (command === 'validate') { const dir = runDir(); validateWave(dir, loadState(dir)); }
    else if (command === 'package') { const dir = runDir(); packageWave(dir, loadState(dir)); }
    else if (command === 'run') autoRun();
    else if (command === 'status') status();
    else if (command === 'pause') pause();
    else if (command === 'stage') stage();
    else if (command === 'fill') fill();
    else throw new Error('usage: full-run.ts <prepare|infer|validate|package|fill|run|status|pause|stage>');
  } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}
