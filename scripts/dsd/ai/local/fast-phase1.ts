import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { InventoryRow, loadInventoryFile } from '../../inventory';
import { LocalRequest, LocalResult, readJsonl, sha256, validateLocalResult } from './protocol';

const ROOT = process.cwd();
const COLUMNS = ['dsd_entry_id','headword','part_of_speech_expectation','dsd_priority','dsd_band','product_rationale',
  'author_contributor_id','authored_date','inventory_evidence_id','declaration_id'] as const;
function arg(name: string): string | undefined { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; }
function required(name: string): string { const v = arg(name)?.trim(); if (!v) throw new Error(`--${name} is required`); return v; }
function positive(name: string, fallback: number): number { const n = Number(arg(name) ?? fallback); if (!Number.isSafeInteger(n) || n < 1) throw new Error(`--${name} must be positive`); return n; }
function safe(value: string): string { if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)) throw new Error('invalid run id'); return value; }
function csv(value: unknown): string { const s = String(value ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function writeNew(file: string, content: string): void { if (fs.existsSync(file)) throw new Error(`refusing to overwrite ${file}`); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content, { flag: 'wx', mode: 0o600 }); }
function writeJson(file: string, value: unknown): void { writeNew(file, JSON.stringify(value, null, 2) + '\n'); }
function writeInventory(file: string, rows: InventoryRow[]): void {
  writeNew(file, [COLUMNS, ...rows.map((row) => COLUMNS.map((key) => row[key]))].map((row) => row.map(csv).join(',')).join('\n') + '\n');
}
function runDir(): string { return path.resolve(ROOT, arg('runs-dir') ?? 'data/dsd/runs', safe(required('run'))); }
function execute(script: string, args: string[]): void {
  const python = script.endsWith('.py'); const bin = python ? path.resolve(ROOT, '.venv-dsd-local/bin/python') : process.execPath;
  const commandArgs = python ? [path.resolve(ROOT, script), ...args] : [require.resolve('ts-node/dist/bin.js'), path.resolve(ROOT, script), ...args];
  const result = childProcess.spawnSync(bin, commandArgs, { cwd: ROOT, env: process.env, stdio: 'inherit' });
  if (result.error) throw result.error; if (result.status !== 0) throw new Error(`${path.basename(script)} failed with exit ${result.status}`);
}
function runner(args: string[]): void { execute('scripts/dsd/ai/local/runner.ts', args); }
function worker(args: string[]): void { execute('scripts/dsd/ai/local/worker.py', args); }
function orderedInventory(file: string): InventoryRow[] {
  const loaded = loadInventoryFile(path.resolve(ROOT, file)); if (loaded.errors.length) throw new Error(loaded.errors.slice(0, 20).join('; '));
  return loaded.rows.map((row) => ({ row, order: sha256(`common-v1:${row.dsd_entry_id}`) }))
    .sort((a, b) => a.order.localeCompare(b.order)).map(({ row }) => row);
}
function prepareClassifier(): void {
  const dir = runDir(); const batch = positive('batch-size', 250); if (batch > 500) throw new Error('--batch-size must be <= 500');
  const rows = orderedInventory(required('inventory')); const payloads: any[] = [];
  for (let offset = 0; offset < rows.length; offset += batch) payloads.push({
    batch_id: `common-${String(payloads.length + 1).padStart(5, '0')}`,
    seed: Number.parseInt(sha256(`common-classifier:${offset}`).slice(0, 8), 16),
    entries: rows.slice(offset, offset + batch).map((row, index) => ({ i: offset + index, headword: row.headword })),
  });
  const payloadFile = path.join(dir, 'classifier.payloads.json'); const requestFile = path.join(dir, 'classifier.requests.jsonl');
  writeJson(payloadFile, payloads); runner(['prepare', '--stage', 'common_classifier', '--payloads', payloadFile, '--output', requestFile]);
  writeJson(path.join(dir, 'run.json'), { version: 1, mode: 'legacy_headwords_common_first', source_inventory: path.resolve(ROOT, required('inventory')),
    source_count: rows.length, classifier_batch_size: batch, classifier_requests: payloads.length, target: positive('target', 20_000), created_at: new Date().toISOString() });
}
function inferClassifier(): void {
  const dir = runDir(); const args = ['--stage', 'common_classifier', '--input', path.join(dir, 'classifier.requests.jsonl'), '--output', path.join(dir, 'classifier.results.jsonl')];
  if (arg('limit')) args.push('--limit', String(positive('limit', 1)));
  worker(args);
  runner(['validate', '--stage', 'common_classifier', '--input', path.join(dir, 'classifier.requests.jsonl'), '--results', path.join(dir, 'classifier.results.jsonl')]);
}
function prepareCommonGate(): void {
  const dir = runDir(); const batch = positive('batch-size', 12); if (batch > 32) throw new Error('--batch-size must be <= 32');
  const loaded = loadInventoryFile(path.resolve(ROOT, required('inventory'))); if (loaded.errors.length) throw new Error(loaded.errors.join('; '));
  const payloads: any[] = [];
  for (let offset = 0; offset < loaded.rows.length; offset += batch) payloads.push({
    batch_id: `gate-${String(payloads.length + 1).padStart(5, '0')}`,
    seed: Number.parseInt(sha256(`common-gate:${offset}`).slice(0, 8), 16),
    entries: loaded.rows.slice(offset, offset + batch).map((row, index) => ({ i: index, headword: row.headword })),
  });
  const payloadFile = path.join(dir, 'gate.payloads.json'); const requestFile = path.join(dir, 'gate.requests.jsonl');
  writeJson(payloadFile, payloads); runner(['prepare', '--stage', 'common_classifier', '--payloads', payloadFile, '--output', requestFile]);
  writeJson(path.join(dir, 'gate-run.json'), { version: 1, source_inventory: path.resolve(ROOT, required('inventory')),
    source_count: loaded.rows.length, batch_size: batch, requests: payloads.length, target: positive('target', 20_000), created_at: new Date().toISOString() });
}
function inferCommonGate(): void {
  const dir = runDir(); const args = ['--stage', 'common_classifier', '--input', path.join(dir, 'gate.requests.jsonl'), '--output', path.join(dir, 'gate.results.jsonl')];
  if (arg('limit')) args.push('--limit', String(positive('limit', 1))); worker(args);
  runner(['validate', '--stage', 'common_classifier', '--input', path.join(dir, 'gate.requests.jsonl'), '--results', path.join(dir, 'gate.results.jsonl')]);
}
function materializeGated(): void {
  const dir = runDir(); const meta = JSON.parse(fs.readFileSync(path.join(dir, 'gate-run.json'), 'utf8'));
  const loaded = loadInventoryFile(meta.source_inventory); if (loaded.errors.length) throw new Error(loaded.errors.join('; '));
  const completed = validCompleted(path.join(dir, 'gate.requests.jsonl'), path.join(dir, 'gate.results.jsonl'));
  const sourceIndex = new Map(loaded.rows.map((row, index) => [row.headword, index]));
  const passed = new Set<number>();
  for (const { request, result } of completed) {
    const entries = (request.payload.entries as Array<{ i: number; headword: string }>);
    for (const id of (result.output as any).common_ids) {
      const entry = entries.find((candidate) => candidate.i === id);
      const index = entry && sourceIndex.get(entry.headword);
      if (index !== undefined) passed.add(index);
    }
  }
  const target = Number(meta.target); if (passed.size < target) throw new Error(`only ${passed.size} gated headwords passed; need ${target}`);
  const rows = [...passed].sort((a, b) => a - b).slice(0, target).map((index, priority) => ({ ...loaded.rows[index],
    dsd_priority: String(priority + 1), dsd_band: 'common-phase1-gated',
    product_rationale: 'Selected by DSD local likelihood ranking and a separate checksum-bound commonness gate.' }));
  writeInventory(path.join(dir, 'common-gated-20000.csv'), rows);
  writeJson(path.join(dir, 'gate-summary.json'), { version: 1, source_count: loaded.rows.length, valid_batches: completed.length,
    passed_unique: passed.size, selected: rows.length, fail_closed_deferred: loaded.rows.length - passed.size,
    created_at: new Date().toISOString() });
}
function validCompleted(requestFile: string, resultFile: string): Array<{ request: LocalRequest; result: LocalResult }> {
  const requests = readJsonl<LocalRequest>(requestFile); const byId = new Map(requests.map((r) => [r.request_id, r]));
  return readJsonl<LocalResult>(resultFile).flatMap((result) => {
    const request = byId.get(result.request_id); return request && result.state === 'completed' && validateLocalResult(result, request).length === 0 ? [{ request, result }] : [];
  });
}
function materializeCommon(): void {
  const dir = runDir(); const meta = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')); const rows = orderedInventory(meta.source_inventory);
  const completed = validCompleted(path.join(dir, 'classifier.requests.jsonl'), path.join(dir, 'classifier.results.jsonl'));
  const common = new Set<number>(); let classifiedEntries = 0;
  for (const { result } of completed) {
    const output: any = result.output; output.common_ids.forEach((i: number) => common.add(i));
  }
  for (const { request } of completed) {
    classifiedEntries += ((request.payload.entries as any[]) ?? []).length;
  }
  const target = Number(meta.target); if (common.size < target) throw new Error(`only ${common.size} common headwords available; need ${target}`);
  const selected = [...common].sort((a, b) => a - b).slice(0, target).map((i, priority) => ({ ...rows[i], dsd_priority: String(priority + 1),
    dsd_band: 'common-phase1', product_rationale: 'Selected for the DSD common-first learner release by an independently recorded local classification pass.' }));
  writeInventory(path.join(dir, 'common-20000.csv'), selected);
  writeJson(path.join(dir, 'classification-summary.json'), { version: 1, valid_batches: completed.length, classified_entries: classifiedEntries,
    common: common.size, selected: selected.length, deferred: classifiedEntries - common.size, created_at: new Date().toISOString() });
}
function prepareEnglish(): void {
  const dir = runDir(); const batch = positive('batch-size', 12); if (batch > 32) throw new Error('--batch-size must be <= 32');
  const inventory = arg('inventory') ? path.resolve(ROOT, required('inventory')) : path.join(dir, 'common-20000.csv');
  const loaded = loadInventoryFile(inventory); if (loaded.errors.length) throw new Error(loaded.errors.join('; '));
  const payloads: any[] = [];
  for (let offset = 0; offset < loaded.rows.length; offset += batch) payloads.push({ seed: Number.parseInt(sha256(`english-batch:${offset}`).slice(0, 8), 16),
    entries: loaded.rows.slice(offset, offset + batch).map((row) => ({ dsd_entry_id: row.dsd_entry_id, headword: row.headword,
      expected_part_of_speech: row.part_of_speech_expectation, product_rationale: row.product_rationale })) });
  const payloadFile = path.join(dir, 'english.payloads.json'); const requestFile = path.join(dir, 'english.requests.jsonl');
  writeJson(payloadFile, payloads); runner(['prepare', '--stage', 'english_batch', '--payloads', payloadFile, '--output', requestFile]);
}
function inferEnglish(): void {
  const dir = runDir(); const args = ['--stage', 'english_batch', '--input', path.join(dir, 'english.requests.jsonl'), '--output', path.join(dir, 'english.results.jsonl')];
  if (arg('limit')) args.push('--limit', String(positive('limit', 1))); worker(args);
  runner(['validate', '--stage', 'english_batch', '--input', path.join(dir, 'english.requests.jsonl'), '--results', path.join(dir, 'english.results.jsonl')]);
}
function prepareCritic(): void {
  const dir = runDir(); const english = validCompleted(path.join(dir, 'english.requests.jsonl'), path.join(dir, 'english.results.jsonl'));
  const payloads = english.map(({ result }, index) => ({ seed: Number.parseInt(sha256(`critic-batch:${index}`).slice(0, 8), 16), entries: (result.output as any).entries }));
  if (!payloads.length) throw new Error('no valid English batches'); const payloadFile = path.join(dir, 'critic.payloads.json');
  writeJson(payloadFile, payloads); runner(['prepare', '--stage', 'critic_batch', '--payloads', payloadFile, '--output', path.join(dir, 'critic.requests.jsonl')]);
}
function inferCritic(): void {
  const dir = runDir(); const args = ['--stage', 'critic_batch', '--input', path.join(dir, 'critic.requests.jsonl'), '--output', path.join(dir, 'critic.results.jsonl')];
  if (arg('limit')) args.push('--limit', String(positive('limit', 1))); worker(args);
  runner(['validate', '--stage', 'critic_batch', '--input', path.join(dir, 'critic.requests.jsonl'), '--results', path.join(dir, 'critic.results.jsonl')]);
}
function main(): void {
  const command = process.argv[2];
  if (command === 'prepare-classifier') prepareClassifier(); else if (command === 'infer-classifier') inferClassifier();
  else if (command === 'prepare-common-gate') prepareCommonGate(); else if (command === 'infer-common-gate') inferCommonGate();
  else if (command === 'materialize-gated') materializeGated();
  else if (command === 'materialize-common') materializeCommon(); else if (command === 'prepare-english') prepareEnglish();
  else if (command === 'infer-english') inferEnglish(); else if (command === 'prepare-critic') prepareCritic();
  else if (command === 'infer-critic') inferCritic(); else throw new Error('usage: fast-phase1.ts <prepare-classifier|infer-classifier|prepare-common-gate|infer-common-gate|materialize-gated|materialize-common|prepare-english|infer-english|prepare-critic|infer-critic>');
}
try { main(); } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
