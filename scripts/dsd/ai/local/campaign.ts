import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { InventoryRow, loadInventoryFile } from '../../inventory';

interface CampaignWave { id: string; offset: number; target: number }
interface Campaign {
  version: 1; campaign_id: string; source_inventory: string; remaining_inventory: string;
  source_count: number; excluded_attempted_count: number; scheduled_count: number;
  wave_size: number; waves: CampaignWave[]; created_at: string;
}
const COLUMNS = ['dsd_entry_id','headword','part_of_speech_expectation','dsd_priority','dsd_band','product_rationale',
  'author_contributor_id','authored_date','inventory_evidence_id','declaration_id'] as const;
function arg(name: string): string | undefined { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; }
function required(name: string): string { const value = arg(name)?.trim(); if (!value) throw new Error(`--${name} is required`); return value; }
function positive(name: string, fallback?: number): number { const n = Number(arg(name) ?? fallback); if (!Number.isSafeInteger(n) || n < 1) throw new Error(`--${name} must be positive`); return n; }
function safe(value: string): string { if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)) throw new Error('invalid campaign id'); return value; }
function csv(value: unknown): string { const s = String(value ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function writeInventory(file: string, rows: InventoryRow[]): void {
  const content = [COLUMNS, ...rows.map((row) => COLUMNS.map((key) => row[key]))]
    .map((row) => row.map(csv).join(',')).join('\n') + '\n';
  fs.writeFileSync(file, content, { flag: 'wx', mode: 0o600 });
}
function campaignDir(id: string): string { return path.resolve(process.cwd(), arg('campaigns-dir') ?? 'data/dsd/campaigns', safe(id)); }
function loadCampaign(id: string): Campaign { return JSON.parse(fs.readFileSync(path.join(campaignDir(id), 'campaign.json'), 'utf8')); }
function attemptedIds(wave: string): Set<string> {
  const file = path.resolve(process.cwd(), arg('runs-dir') ?? 'data/dsd/runs', wave, 'english.payloads.json');
  if (!fs.existsSync(file)) throw new Error(`excluded wave has no English payloads: ${wave}`);
  return new Set((JSON.parse(fs.readFileSync(file, 'utf8')) as any[]).map((row) => String(row.dsd_entry_id)));
}
function prepare(): void {
  const id = required('campaign'); const dir = campaignDir(id); const source = path.resolve(process.cwd(), required('inventory'));
  if (fs.existsSync(dir)) throw new Error(`campaign already exists: ${dir}`);
  const loaded = loadInventoryFile(source); if (loaded.errors.length) throw new Error(`invalid inventory: ${loaded.errors.slice(0, 20).join('; ')}`);
  const excludedWaves = (arg('exclude-waves') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  const excluded = new Set<string>(); excludedWaves.forEach((wave) => attemptedIds(wave).forEach((entryId) => excluded.add(entryId)));
  const remaining = loaded.rows.filter((row) => !excluded.has(row.dsd_entry_id));
  const waveSize = positive('wave-size', 500); const waves: CampaignWave[] = [];
  for (let offset = 0, index = 1; offset < remaining.length; offset += waveSize, index += 1) {
    waves.push({ id: `${safe(id)}-${String(index).padStart(4, '0')}`, offset,
      target: Math.min(waveSize, remaining.length - offset) });
  }
  fs.mkdirSync(dir, { recursive: true }); const remainingFile = path.join(dir, 'remaining-inventory.csv');
  writeInventory(remainingFile, remaining);
  const value: Campaign = { version: 1, campaign_id: id, source_inventory: source, remaining_inventory: remainingFile,
    source_count: loaded.rows.length, excluded_attempted_count: loaded.rows.length - remaining.length,
    scheduled_count: remaining.length, wave_size: waveSize, waves, created_at: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, 'campaign.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(value, null, 2));
}
function waveState(wave: CampaignWave): any | undefined {
  const file = path.resolve(process.cwd(), arg('runs-dir') ?? 'data/dsd/runs', wave.id, 'state.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
}
function summary(campaign: Campaign) {
  const counts = { pending: 0, running: 0, packaged: 0, failed_or_stopped: 0, attempted: 0, passed: 0, quarantined: 0 };
  for (const wave of campaign.waves) {
    const state = waveState(wave);
    if (!state) { counts.pending += 1; continue; }
    counts.attempted += Number(state.counts?.requested ?? 0); counts.passed += Number(state.counts?.packaged ?? 0);
    counts.quarantined += Number(state.counts?.quarantined ?? 0);
    if (state.step === 'packaged') counts.packaged += 1;
    else if (state.paused) counts.failed_or_stopped += 1;
    else counts.running += 1;
  }
  const completedEntries = counts.passed + counts.quarantined;
  const remainingEntries = Math.max(0, campaign.scheduled_count - completedEntries);
  const nextWave = campaign.waves.find((wave) => waveState(wave)?.step !== 'packaged');
  return {
    ...counts,
    total_waves: campaign.waves.length,
    completed_entries: completedEntries,
    remaining_entries: remainingEntries,
    completion_percent: Number(((completedEntries / campaign.scheduled_count) * 100).toFixed(2)),
    next_wave: nextWave?.id ?? null,
  };
}
function status(): void {
  const campaign = loadCampaign(required('campaign'));
  const metadata = {
    campaign_id: campaign.campaign_id,
    source_count: campaign.source_count,
    excluded_attempted_count: campaign.excluded_attempted_count,
    scheduled_count: campaign.scheduled_count,
    wave_size: campaign.wave_size,
    total_waves: campaign.waves.length,
    created_at: campaign.created_at,
  };
  console.log(JSON.stringify({ campaign: metadata, status: summary(campaign) }, null, 2));
}
function run(): void {
  const campaign = loadCampaign(required('campaign')); const maxWaves = positive('max-waves', 1);
  let executed = 0;
  for (const wave of campaign.waves) {
    const state = waveState(wave); if (state?.step === 'packaged') continue;
    if (executed >= maxWaves) break;
    const args = [require.resolve('ts-node/dist/bin.js'), path.resolve(process.cwd(), 'scripts/dsd/ai/local/full-run.ts'), 'run',
      '--wave', wave.id, '--inventory', campaign.remaining_inventory, '--target', String(wave.target),
      '--inventory-offset', String(wave.offset), '--inventory-stride', '1', '--max-repairs', String(positive('max-repairs', 2))];
    const result = childProcess.spawnSync(process.execPath, args, { cwd: process.cwd(), env: process.env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`campaign stopped fail-closed at ${wave.id}`);
    executed += 1;
  }
  console.log(JSON.stringify(summary(campaign), null, 2));
}
try {
  const command = process.argv[2];
  if (command === 'prepare') prepare(); else if (command === 'status') status(); else if (command === 'run') run();
  else throw new Error('usage: campaign.ts <prepare|status|run>');
} catch (error) { console.error((error as Error).message); process.exitCode = 1; }
