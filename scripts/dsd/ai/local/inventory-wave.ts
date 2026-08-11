import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { buildInventoryCells, InventoryPlan, validateInventoryPlan } from '../inventory-planner';
import { sha256 } from './protocol';

const ROOT = process.cwd();

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function required(name: string): string { const value = arg(name)?.trim(); if (!value) throw new Error(`--${name} is required`); return value; }
function integer(name: string, fallback?: number): number {
  const value = Number(arg(name) ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`--${name} must be a non-negative integer`);
  return value;
}
function execute(script: string, args: string[]): void {
  const python = script.endsWith('.py');
  const bin = python ? path.resolve(ROOT, '.venv-dsd-local/bin/python') : process.execPath;
  const commandArgs = python ? [path.resolve(ROOT, script), ...args]
    : [require.resolve('ts-node/dist/bin.js'), path.resolve(ROOT, script), ...args];
  const result = childProcess.spawnSync(bin, commandArgs, { cwd: ROOT, env: process.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(script)} failed with exit ${result.status}`);
}
function writeNew(file: string, value: unknown): void {
  if (fs.existsSync(file)) throw new Error(`refusing to overwrite: ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const partial = `${file}.partial`;
  fs.writeFileSync(partial, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(partial, file);
}

function main(): void {
  if (process.argv[2] !== 'run') throw new Error('usage: inventory-wave.ts run --wave ID --plan FILE --existing-inventory FILE --target N [--offset N] [--cells N]');
  if (!process.env.DSD_LOCAL_MODEL_HOME?.trim()) throw new Error('DSD_LOCAL_MODEL_HOME is required');
  const wave = required('wave');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(wave)) throw new Error('invalid --wave');
  const planFile = path.resolve(ROOT, required('plan'));
  const existing = path.resolve(ROOT, required('existing-inventory'));
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8')) as InventoryPlan;
  const errors = validateInventoryPlan(plan); if (errors.length) throw new Error(errors.join('; '));
  const offset = integer('offset', 0); const cellCount = integer('cells', 6); const stride = integer('stride', 1);
  const target = integer('target'); const candidatesPerRequest = integer('candidates-per-request', 25);
  const candidatesPerCell = integer('candidates-per-cell', plan.candidates_per_cell);
  if (cellCount < 1 || stride < 1 || target < 1 || candidatesPerRequest < 1 || candidatesPerRequest > 50 ||
      candidatesPerCell < 1 || candidatesPerCell > plan.candidates_per_cell) {
    throw new Error('--cells, --stride and --target must be positive; --candidates-per-request must be 1..50');
  }
  const allCells = buildInventoryCells(plan);
  const cells = Array.from({ length: cellCount }, (_, index) => allCells[offset + index * stride]).filter(Boolean);
  if (cells.length !== cellCount) throw new Error('requested cells exceed the plan');
  const dir = path.resolve(ROOT, arg('runs-dir') ?? 'data/dsd/runs', wave, 'inventory');
  const payloads = path.join(dir, 'generator.payloads.json'); const requests = path.join(dir, 'generator.requests.jsonl');
  const results = path.join(dir, 'generator.results.jsonl'); const criticPayloads = path.join(dir, 'critic.payloads.json');
  const criticRequests = path.join(dir, 'critic.requests.jsonl'); const criticResults = path.join(dir, 'critic.results.jsonl');
  const inventory = path.join(dir, 'inventory.csv'); const manifest = path.join(dir, 'manifest.json');
  const chunks = cells.flatMap((cell) => Array.from({ length: Math.ceil(candidatesPerCell / candidatesPerRequest) }, (_, index) => ({
    coverage_cell_id: `${cell.id}-CHUNK-${String(index + 1).padStart(2, '0')}`,
    level: cell.level, register: cell.register, part_of_speech: cell.partOfSpeech, topic: cell.topic,
    requested_count: Math.min(candidatesPerRequest, candidatesPerCell - index * candidatesPerRequest),
    seed: Number.parseInt(sha256(`${plan.plan_id}:${cell.id}:${index + 1}`).slice(0, 8), 16),
  })));
  if (!fs.existsSync(payloads)) writeNew(payloads, chunks);
  if (!fs.existsSync(requests)) execute('scripts/dsd/ai/local/runner.ts', ['prepare', '--stage', 'inventory', '--payloads', payloads, '--output', requests]);
  execute('scripts/dsd/ai/local/worker.py', ['--stage', 'inventory', '--input', requests, '--output', results]);
  execute('scripts/dsd/ai/local/runner.ts', ['validate', '--stage', 'inventory', '--input', requests, '--results', results]);
  if (!fs.existsSync(criticPayloads)) execute('scripts/dsd/ai/local/calibration.ts', ['prepare-inventory-critic', '--input', requests,
    '--results', results, '--existing-inventory', existing, '--output', criticPayloads]);
  const unique = (JSON.parse(fs.readFileSync(criticPayloads, 'utf8')) as unknown[]).length;
  if (unique < target) throw new Error(`only ${unique} unique candidates for target ${target}; add coverage cells`);
  if (!fs.existsSync(criticRequests)) execute('scripts/dsd/ai/local/runner.ts', ['prepare', '--stage', 'inventory_critic', '--payloads', criticPayloads, '--output', criticRequests]);
  execute('scripts/dsd/ai/local/worker.py', ['--stage', 'inventory_critic', '--input', criticRequests, '--output', criticResults]);
  execute('scripts/dsd/ai/local/runner.ts', ['validate', '--stage', 'inventory_critic', '--input', criticRequests, '--results', criticResults]);
  const criticRows = fs.readFileSync(criticResults, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const passed = criticRows.filter((row) => row.output?.decision === 'pass').length;
  if (passed < target) throw new Error(`only ${passed} critic-passed candidates for target ${target}; add coverage cells`);
  if (!fs.existsSync(inventory)) execute('scripts/dsd/ai/local/calibration.ts', ['materialize-reserve', '--critic-input', criticRequests,
    '--critic-results', criticResults, '--start-priority', '1', '--limit', String(target), '--output', inventory]);
  if (!fs.existsSync(manifest)) writeNew(manifest, { version: 1, wave_id: wave, plan_id: plan.plan_id, cell_offset: offset,
    cell_count: cellCount, cell_stride: stride, request_count: chunks.length,
    candidates_per_cell: candidatesPerCell, candidates_per_request: candidatesPerRequest,
    generated: chunks.reduce((sum, chunk) => sum + chunk.requested_count, 0),
    unique, critic_passed: passed,
    selected: target, legacy_inventory_used: false, inventory });
  console.log(fs.readFileSync(manifest, 'utf8'));
}

try { main(); } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
