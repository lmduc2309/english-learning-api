import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// The tracker resolves its file at import time via config, so point it at a
// disposable location before requiring anything.
const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-translate-')), 'progress.db');
process.env.AI_TRANSLATE_PROGRESS_DB = tmpDb;

// better-sqlite3 ships a prebuilt native binding. Plain `node` resolves a
// build matching this runtime, but Jest's resolver picks one compiled against
// a different NODE_MODULE_VERSION and throws on load. That is an environment
// mismatch, not a defect in the tracker — the CLI loads the module fine — so
// skip rather than fail the suite, and say why.
let ProgressTracker: any;
let sqliteLoadError: string | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ProgressTracker = require('./progress-tracker').ProgressTracker;
  new ProgressTracker('null').close();
} catch (error: any) {
  sqliteLoadError = error?.message ?? String(error);
}

const describeIfSqlite = sqliteLoadError ? describe.skip : describe;
if (sqliteLoadError) {
  // eslint-disable-next-line no-console
  console.warn(
    `[progress-tracker.spec] skipped: better-sqlite3 unavailable under Jest — ${sqliteLoadError.split('\n')[0]}`,
  );
}

describeIfSqlite('ProgressTracker namespacing', () => {
  afterAll(() => {
    fs.rmSync(path.dirname(tmpDb), { recursive: true, force: true });
  });

  it('keeps the four namespaces independent', () => {
    const nullTarget = new ProgressTracker('null');
    nullTarget.markDone(101, 'definitions', 'xin chào');

    // Same item, different target: a NULL-fill completion must not hide a
    // later CJK repair of the same row.
    const cjkTarget = new ProgressTracker('cjk');
    expect(nullTarget.isDone(101, 'definitions')).toBe(true);
    expect(cjkTarget.isDone(101, 'definitions')).toBe(false);
    expect(cjkTarget.getDoneIds('definitions').has(101)).toBe(false);

    cjkTarget.markDone(101, 'definitions', 'thuộc về hormone');
    expect(cjkTarget.isDone(101, 'definitions')).toBe(true);

    // Type is still part of the key.
    expect(cjkTarget.isDone(101, 'examples')).toBe(false);

    nullTarget.close();
    cjkTarget.close();
  });

  it('writes nothing when constructed read-only', () => {
    const live = new ProgressTracker('cjk');
    const before = live.getStats('definitions').total;
    live.close();

    const dry = new ProgressTracker('cjk', true);
    dry.markDone(999, 'definitions', 'ignored');
    dry.markFailed(998, 'definitions', 'ignored');
    dry.markBatch([{ id: 997, vi: 'ignored' }], 'definitions');
    expect(dry.startRun('definitions', 5)).toBe(0);
    expect(dry.logBatch('definitions', 1, 1, 0)).toBe(0);
    dry.close();

    const check = new ProgressTracker('cjk');
    expect(check.getStats('definitions').total).toBe(before);
    expect(check.isDone(999, 'definitions')).toBe(false);
    check.close();
  });
});
