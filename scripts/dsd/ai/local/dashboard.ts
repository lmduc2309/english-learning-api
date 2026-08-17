import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';

const ROOT = process.cwd();
const RUNS = path.resolve(ROOT, 'data/dsd/runs');
const PORT = Number(process.argv[process.argv.indexOf('--port') + 1] || 4317);
const STAGES = ['inventory', 'inventory_critic', 'common_classifier', 'english', 'english_batch', 'critic', 'critic_batch', 'translate'] as const;

function json(file: string): any | undefined {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; }
}
function lines(file: string): any[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}
function files(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const item = path.join(dir, entry.name);
    return entry.isDirectory() ? files(item) : [item];
  });
}
function headword(payload: any): string {
  return String(payload?.headword || payload?.source_text || payload?.dsd_entry_id || '—');
}
function wave(dir: string) {
  const all = files(dir); const state = json(path.join(dir, 'state.json'));
  const requestRows = all.filter((f) => f.endsWith('.requests.jsonl')).flatMap(lines);
  const resultRows = all.filter((f) => f.endsWith('.results.jsonl')).flatMap((file) => {
    const at = fs.statSync(file).mtimeMs;
    return lines(file).map((row) => ({ ...row, __dashboard_at: at }));
  });
  const requests = new Map(requestRows.map((row) => [row.request_id, row]));
  const seen = new Set<string>(); const stageStats: Record<string, any> = {};
  for (const stage of STAGES) stageStats[stage] = { requested: 0, completed: 0, failed: 0, tokens: 0, elapsed_ms: 0, pass: 0, repair: 0, quarantine: 0 };
  for (const row of requestRows) if (stageStats[row.stage]) stageStats[row.stage].requested += 1;
  const events: any[] = [];
  for (const result of resultRows) {
    if (seen.has(result.request_id)) continue; seen.add(result.request_id);
    const request: any = requests.get(result.request_id); if (!request || !stageStats[request.stage]) continue;
    const stat = stageStats[request.stage]; result.state === 'completed' ? stat.completed += 1 : stat.failed += 1;
    stat.tokens += Number(result.input_tokens || 0) + Number(result.output_tokens || 0);
    stat.elapsed_ms += Number(result.elapsed_ms || 0);
    const decision = result.output?.decision;
    if (decision && stat[decision] !== undefined) stat[decision] += 1;
    events.push({ stage: request.stage, model: request.model_id, headword: headword(request.payload),
      state: result.state, decision, reasons: result.output?.reason_codes || [], elapsed_ms: result.elapsed_ms,
      at: result.__dashboard_at });
  }
  const active = STAGES.find((stage) => stageStats[stage].requested > stageStats[stage].completed + stageStats[stage].failed) ||
    (state?.step === 'packaged' ? 'packaged' : state?.step || 'preparing');
  const inventoryTarget = path.basename(dir) === 'common-phase1-inventory-20000' ? 20_000 : 0;
  return { id: path.basename(dir), target: state?.target || inventoryTarget, step: state?.step || 'inventory', paused: Boolean(state?.paused),
    updated_at: state?.updated_at || fs.statSync(dir).mtime.toISOString(), active, stages: stageStats,
    package_ready: all.some((f) => /draft-package(?:-final)?\.json$/.test(f)), events: events.slice(-24).reverse() };
}
function snapshot() {
  const dirs = fs.existsSync(RUNS) ? fs.readdirSync(RUNS, { withFileTypes: true }).filter((e) => e.isDirectory())
    .map((e) => path.join(RUNS, e.name)) : [];
  const waves = dirs.map(wave).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  const current = waves.find((w) => !w.package_ready && !w.paused) || waves[0];
  return { generated_at: new Date().toISOString(), current, waves: waves.slice(0, 60), safety: 'Local drafts only — production is unchanged' };
}

const HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSD Corpus Flow</title><style>
:root{--bg:#07111d;--panel:#0d1b2a;--line:#21364b;--text:#e9f1f7;--muted:#88a0b6;--cyan:#38d9c5;--amber:#ffbf69;--red:#ff6b6b;--blue:#55aaff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% 0,#12304a 0,transparent 32%),var(--bg);color:var(--text);font:14px ui-monospace,SFMono-Regular,Menlo,monospace}.wrap{max-width:1440px;margin:auto;padding:26px}.top{display:flex;justify-content:space-between;gap:20px;align-items:end;margin-bottom:22px}h1{font:700 30px system-ui;margin:0}.sub,.muted{color:var(--muted)}.live{color:var(--cyan)}.grid{display:grid;grid-template-columns:2fr 1fr;gap:16px}.panel{background:#0d1b2add;border:1px solid var(--line);border-radius:14px;padding:18px;box-shadow:0 16px 50px #0004}.flow{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;align-items:center}.stage{min-width:0;padding:14px 10px;border:1px solid var(--line);border-radius:10px;background:#0a1623}.stage.active{border-color:var(--cyan);box-shadow:0 0 0 1px #38d9c544}.stage .name{font-weight:700;text-transform:uppercase;font-size:11px;letter-spacing:.08em}.stage .num{font:700 21px system-ui;margin:8px 0}.bar{height:5px;background:#1d3042;border-radius:9px;overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--blue),var(--cyan))}.arrow{text-align:center;color:var(--muted)}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 7px;border-bottom:1px solid #1b2c3d;font-size:12px}th{color:var(--muted)}.pill{padding:3px 7px;border:1px solid var(--line);border-radius:20px}.pass{color:var(--cyan)}.repair{color:var(--amber)}.quarantine,.failed{color:var(--red)}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}.metric{padding:13px;background:#091624;border-radius:10px}.metric b{font:700 22px system-ui;display:block;margin-top:5px}.waves{max-height:440px;overflow:auto}.wave{display:grid;grid-template-columns:1fr 100px 90px;gap:8px;padding:9px 0;border-bottom:1px solid #1b2c3d}.eventbox{max-height:470px;overflow:auto}@media(max-width:900px){.grid{grid-template-columns:1fr}.flow{grid-template-columns:1fr}.arrow{transform:rotate(90deg)}.cards{grid-template-columns:repeat(2,1fr)}}
</style></head><body><div class="wrap"><div class="top"><div><h1>DSD Corpus Flow</h1><div class="sub">Generator → independent critic → repair → translation → draft package</div></div><div><span class="live">● LIVE</span> <span id="clock" class="muted"></span></div></div><div id="app"></div></div><script>
const fmt=n=>Number(n||0).toLocaleString(); const pct=(a,b)=>b?Math.min(100,a/b*100):0;
function stage(name,s,active){let done=s.completed+s.failed;return '<div class="stage '+(active===name?'active':'')+'"><div class="name">'+name.replace('_',' ')+'</div><div class="num">'+fmt(done)+' / '+fmt(s.requested)+'</div><div class="bar"><i style="width:'+pct(done,s.requested)+'%"></i></div><div class="muted" style="margin-top:8px">'+fmt(s.tokens)+' tokens · '+s.failed+' errors</div>'+(name.includes('critic')?'<div style="margin-top:7px"><span class="pass">'+s.pass+' pass</span> · <span class="repair">'+s.repair+' repair</span> · <span class="quarantine">'+s.quarantine+' hold</span></div>':'')+'</div>'}
function render(d){let w=d.current;if(!w){app.innerHTML='<div class="panel">No run found.</div>';return}let ss=w.stages,done=Object.values(ss).reduce((n,s)=>n+s.completed,0),fail=Object.values(ss).reduce((n,s)=>n+s.failed,0),tok=Object.values(ss).reduce((n,s)=>n+s.tokens,0);let names=ss.common_classifier.requested?['common_classifier','english_batch','critic_batch','translate']:['inventory','inventory_critic','english','critic','translate'];let flow=names.map((n,i)=>stage(n,ss[n],w.active)+(i<names.length-1?'<div class="arrow">→</div>':'')).join('');flow+='<div class="stage '+(w.active==='packaged'?'active':'')+'"><div class="name">package</div><div class="num">'+(w.package_ready?'READY':'WAIT')+'</div><div class="muted">draft only</div></div>';
let ev=w.events.map(e=>'<tr><td>'+e.headword+'</td><td><span class="pill">'+e.stage+'</span></td><td>'+e.model+'</td><td class="'+(e.decision||e.state)+'">'+(e.decision||e.state)+'</td><td>'+((e.elapsed_ms||0)/1000).toFixed(1)+'s</td></tr>').join('');let waves=d.waves.map(x=>{let st=x.stages,terminal=Object.values(st).reduce((n,s)=>n+s.completed+s.failed,0),requested=Object.values(st).reduce((n,s)=>n+s.requested,0);return '<div class="wave"><span>'+x.id+'</span><span>'+x.active+'</span><span>'+pct(terminal,requested).toFixed(0)+'%</span></div>'}).join('');
app.innerHTML='<div class="panel"><div class="muted">ACTIVE FLOW · '+w.id+'</div><div class="flow" style="margin-top:14px">'+flow+'</div><div class="cards"><div class="metric"><span class="muted">Completed calls</span><b>'+fmt(done)+'</b></div><div class="metric"><span class="muted">Failures</span><b class="'+(fail?'failed':'')+'">'+fmt(fail)+'</b></div><div class="metric"><span class="muted">Tokens</span><b>'+fmt(tok)+'</b></div><div class="metric"><span class="muted">Target entries</span><b>'+fmt(w.target)+'</b></div></div></div><div class="grid" style="margin-top:16px"><div class="panel"><div class="muted">RECENT PACKETS</div><div class="eventbox"><table><thead><tr><th>Headword / packet</th><th>Stage</th><th>Model</th><th>Result</th><th>Latency</th></tr></thead><tbody>'+ev+'</tbody></table></div></div><div class="panel"><div class="muted">RUN QUEUE</div><div class="waves">'+waves+'</div><div class="muted" style="margin-top:14px">'+d.safety+'</div></div></div>';clock.textContent=new Date(d.generated_at).toLocaleTimeString()}
async function poll(){try{render(await(await fetch('/api/status')).json())}catch(e){clock.textContent='disconnected'}setTimeout(poll,2000)}poll();</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/api/status') { res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); return res.end(JSON.stringify(snapshot())); }
  if (req.url === '/' || req.url === '/index.html') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(HTML); }
  res.statusCode = 404; res.end('Not found');
});
if (!Number.isSafeInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error('--port must be 1024..65535');
server.listen(PORT, '127.0.0.1', () => console.log(`DSD Corpus Flow: http://127.0.0.1:${PORT}`));
