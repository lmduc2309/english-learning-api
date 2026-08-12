import * as fs from 'fs';
import * as path from 'path';
import { LocalRequest, LocalResult, LocalStage } from './protocol';

type StageStats = {
  requested: number; completed: number; failed: number; inputTokens: number; outputTokens: number;
  elapsedMs: number; latencies: number[]; pass: number; repair: number; quarantine: number;
};

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function required(name: string): string { const value = arg(name)?.trim(); if (!value) throw new Error(`--${name} is required`); return value; }
function emptyStats(): StageStats {
  return { requested: 0, completed: 0, failed: 0, inputTokens: 0, outputTokens: 0,
    elapsedMs: 0, latencies: [], pass: 0, repair: 0, quarantine: 0 };
}
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
}
export function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}
export function estimateEta(requested: number, terminal: number, elapsedMs: number): number {
  if (!terminal || terminal >= requested) return terminal >= requested ? 0 : Number.POSITIVE_INFINITY;
  return ((requested - terminal) * elapsedMs / terminal) / 1000;
}
function bytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']; let amount = value; let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}
function list(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? list(file) : [file];
  });
}
const jsonlCache = new Map<string, { offset: number; carry: string; rows: any[] }>();
function jsonl(file: string): any[] {
  const size = fs.statSync(file).size;
  let cached = jsonlCache.get(file) ?? { offset: 0, carry: '', rows: [] };
  if (size < cached.offset) cached = { offset: 0, carry: '', rows: [] };
  if (size === cached.offset) return cached.rows;
  const length = size - cached.offset; const buffer = Buffer.alloc(length);
  const descriptor = fs.openSync(file, 'r');
  try { fs.readSync(descriptor, buffer, 0, length, cached.offset); } finally { fs.closeSync(descriptor); }
  const pieces = (cached.carry + buffer.toString('utf8')).split(/\r?\n/);
  cached.carry = pieces.pop() ?? '';
  for (const line of pieces) {
    if (!line) continue;
    try { cached.rows.push(JSON.parse(line)); } catch { /* partial/corrupt lines remain excluded from metrics */ }
  }
  cached.offset = size; jsonlCache.set(file, cached); return cached.rows;
}
function bar(done: number, total: number, width = 24): string {
  const ratio = total ? Math.min(1, done / total) : 0; const filled = Math.round(ratio * width);
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${(ratio * 100).toFixed(1)}%`;
}
function render(dir: string): string {
  const statePath = path.join(dir, 'state.json');
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : undefined;
  const files = list(dir); const requests = files.filter((file) => file.endsWith('.requests.jsonl'));
  const results = files.filter((file) => file.endsWith('.results.jsonl'));
  const stageById = new Map<string, LocalStage>(); const stats = new Map<LocalStage, StageStats>();
  const get = (stage: LocalStage) => { if (!stats.has(stage)) stats.set(stage, emptyStats()); return stats.get(stage)!; };
  for (const file of requests) for (const request of jsonl(file) as LocalRequest[]) {
    if (stageById.has(request.request_id)) continue;
    stageById.set(request.request_id, request.stage); get(request.stage).requested += 1;
  }
  const seen = new Set<string>();
  for (const file of results) for (const result of jsonl(file) as LocalResult[]) {
    if (seen.has(result.request_id)) continue; seen.add(result.request_id);
    const stage = stageById.get(result.request_id); if (!stage) continue;
    const value = get(stage); const terminal = result.state === 'completed';
    terminal ? value.completed += 1 : value.failed += 1;
    value.inputTokens += result.input_tokens || 0; value.outputTokens += result.output_tokens || 0;
    value.elapsedMs += result.elapsed_ms || 0; value.latencies.push(result.elapsed_ms || 0);
    const decision = (result.output as any)?.decision;
    if (decision === 'pass') value.pass += 1;
    if (decision === 'repair') value.repair += 1;
    if (decision === 'quarantine') value.quarantine += 1;
  }
  const now = new Date(); const totalBytes = files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
  const disk = fs.statfsSync(dir); const diskFree = disk.bavail * disk.bsize;
  const lines = [
    `DSD LOCAL CORPUS MONITOR  ${now.toLocaleString()}`,
    `Wave: ${state?.wave_id ?? path.basename(dir)}  Ledger: ${state?.step ?? 'preparing'}  Paused: ${state?.paused ? 'YES' : 'no'}`,
    `Target: ${Number(state?.target ?? 0).toLocaleString()}  Sample: offset ${state?.inventory_offset ?? 0}, stride ${state?.inventory_stride ?? 1}`,
    `Spools: ${bytes(totalBytes)}  Disk free: ${bytes(diskFree)}  Updated: ${state?.updated_at ?? '—'}`,
    '',
    'STAGE                PROGRESS                            OK   FAIL   AVG    P95      TOKENS     ETA',
  ];
  const order: LocalStage[] = ['inventory', 'inventory_critic', 'english', 'critic', 'translate'];
  for (const stage of order) {
    const value = stats.get(stage); if (!value) continue;
    const terminal = value.completed + value.failed; const avg = terminal ? value.elapsedMs / terminal : 0;
    const eta = estimateEta(value.requested, terminal, value.elapsedMs);
    lines.push(`${stage.padEnd(20)} ${bar(terminal, value.requested)} ` +
      `${String(value.completed).padStart(5)} ${String(value.failed).padStart(6)} ` +
      `${formatDuration(avg / 1000).padStart(6)} ${formatDuration(percentile(value.latencies, .95) / 1000).padStart(7)} ` +
      `${String(value.inputTokens + value.outputTokens).padStart(10)} ${formatDuration(eta).padStart(9)}`);
    if (stage === 'critic' || stage === 'inventory_critic') {
      lines.push(`${''.padEnd(20)} decisions: pass=${value.pass} repair=${value.repair} quarantine=${value.quarantine}`);
    }
  }
  const packageFile = files.find((file) => path.basename(file) === 'draft-package-final.json') ||
    files.find((file) => path.basename(file) === 'draft-package.json');
  lines.push('', `Package: ${packageFile ? packageFile : 'not assembled'}`,
    'Safety: offline drafts only; no automatic approval, publication, or production import.',
    '', 'Ctrl+C to exit monitor (the model worker continues).');
  return lines.join('\n');
}

function main(): void {
  const wave = required('wave');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(wave)) throw new Error('invalid --wave');
  const dir = path.resolve(process.cwd(), arg('runs-dir') ?? 'data/dsd/runs', wave);
  if (!fs.existsSync(dir)) throw new Error(`wave not found: ${dir}`);
  const once = process.argv.includes('--once'); const interval = Number(arg('interval') ?? 5);
  if (!Number.isFinite(interval) || interval < 1) throw new Error('--interval must be at least 1 second');
  const draw = () => { if (!once && process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[H'); console.log(render(dir)); };
  draw(); if (!once) setInterval(draw, interval * 1000);
}
if (require.main === module) { try { main(); } catch (error) { console.error((error as Error).message); process.exit(1); } }
