import * as Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';
import type { TranslationType, TranslationTarget } from './types';

export class ProgressTracker {
  private db: Database.Database;
  private readonly namespace: string;
  private readonly readOnly: boolean;


  constructor(target: TranslationTarget = 'null', readOnly = false) {
    const dir = path.dirname(config.progress.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(config.progress.dbPath);
    // Progress is scoped to (database, target). A NULL-fill completion must
    // never hide a later CJK repair, and a rehearsal completion must never
    // hide a production item.
    this.namespace = `${config.db.database}:${target}`;
    this.readOnly = readOnly;
    this.db.pragma('journal_mode = WAL');
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS translation_progress_v2 (
        namespace TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        type TEXT NOT NULL DEFAULT 'definition',
        status TEXT NOT NULL DEFAULT 'pending',
        vi_text TEXT,
        translated_at TEXT,
        error_msg TEXT,
        PRIMARY KEY (namespace, item_id, type)
      );

      CREATE TABLE IF NOT EXISTS batch_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        item_count INTEGER NOT NULL,
        success_count INTEGER DEFAULT 0,
        fail_count INTEGER DEFAULT 0,
        error_msg TEXT
      );

      CREATE TABLE IF NOT EXISTS run_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        total_items INTEGER DEFAULT 0,
        translated INTEGER DEFAULT 0,
        failed INTEGER DEFAULT 0,
        requests_made INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_progress_v2_status
        ON translation_progress_v2(namespace, type, status);
    `);

    // Adopt pre-namespace rows exactly once. They were produced by NULL-fill
    // runs against the default database, so they belong to that namespace only
    // — treating them as CJK progress would skip rows that were never repaired.
    const legacy = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='translation_progress'`)
      .get();
    if (legacy) {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO translation_progress_v2
             (namespace, item_id, type, status, vi_text, translated_at, error_msg)
           SELECT ?, item_id, type, status, vi_text, translated_at, error_msg
             FROM translation_progress`,
        )
        .run(`${config.db.database}:null`);
    }
  }

  isDone(itemId: number, type: TranslationType): boolean {
    const row = this.db
      .prepare(
        'SELECT status FROM translation_progress_v2 WHERE namespace = ? AND item_id = ? AND type = ?',
      )
      .get(this.namespace, itemId, type) as { status: string } | undefined;
    return row?.status === 'done';
  }

  getDoneIds(type: TranslationType): Set<number> {
    const rows = this.db
      .prepare(
        "SELECT item_id FROM translation_progress_v2 WHERE namespace = ? AND type = ? AND status = 'done'",
      )
      .all(this.namespace, type) as { item_id: number }[];
    return new Set(rows.map((r) => r.item_id));
  }

  markDone(itemId: number, type: TranslationType, viText: string): void {
    if (this.readOnly) return;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO translation_progress_v2
           (namespace, item_id, type, status, vi_text, translated_at)
         VALUES (?, ?, ?, 'done', ?, datetime('now'))`,
      )
      .run(this.namespace, itemId, type, viText);
  }

  markFailed(itemId: number, type: TranslationType, error: string): void {
    if (this.readOnly) return;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO translation_progress_v2
           (namespace, item_id, type, status, error_msg, translated_at)
         VALUES (?, ?, ?, 'failed', ?, datetime('now'))`,
      )
      .run(this.namespace, itemId, type, error);
  }

  markBatch(items: { id: number; vi: string }[], type: TranslationType): void {
    if (this.readOnly) return;
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO translation_progress_v2
         (namespace, item_id, type, status, vi_text, translated_at)
       VALUES (?, ?, ?, 'done', ?, datetime('now'))`,
    );

    const tx = this.db.transaction((rows: { id: number; vi: string }[]) => {
      for (const row of rows) {
        insert.run(this.namespace, row.id, type, row.vi);
      }
    });

    tx(items);
  }

  logBatch(
    type: TranslationType,
    itemCount: number,
    successCount: number,
    failCount: number,
    error?: string,
  ): number {
    if (this.readOnly) return 0;
    const result = this.db
      .prepare(
        `INSERT INTO batch_log (type, started_at, completed_at, item_count, success_count, fail_count, error_msg)
         VALUES (?, datetime('now'), datetime('now'), ?, ?, ?, ?)`,
      )
      .run(type, itemCount, successCount, failCount, error || null);
    return result.lastInsertRowid as number;
  }

  startRun(type: TranslationType, totalItems: number): number {
    if (this.readOnly) return 0;
    const result = this.db
      .prepare(
        `INSERT INTO run_stats (type, started_at, total_items)
         VALUES (?, datetime('now'), ?)`,
      )
      .run(type, totalItems);
    return result.lastInsertRowid as number;
  }

  updateRun(runId: number, translated: number, failed: number, requests: number): void {
    if (this.readOnly) return;
    this.db
      .prepare(
        `UPDATE run_stats SET translated = ?, failed = ?, requests_made = ?, ended_at = datetime('now')
         WHERE id = ?`,
      )
      .run(translated, failed, requests, runId);
  }

  getStats(type: TranslationType): {
    total: number;
    done: number;
    failed: number;
    pending: number;
  } {
    const done =
      (
        this.db
          .prepare(
            "SELECT COUNT(*) as c FROM translation_progress_v2 WHERE namespace = ? AND type = ? AND status = 'done'",
          )
          .get(this.namespace, type) as { c: number }
      )?.c || 0;

    const failed =
      (
        this.db
          .prepare(
            "SELECT COUNT(*) as c FROM translation_progress_v2 WHERE namespace = ? AND type = ? AND status = 'failed'",
          )
          .get(this.namespace, type) as { c: number }
      )?.c || 0;

    const total =
      (
        this.db
          .prepare('SELECT COUNT(*) as c FROM translation_progress_v2 WHERE namespace = ? AND type = ?')
          .get(this.namespace, type) as { c: number }
      )?.c || 0;

    return { total, done, failed, pending: total - done - failed };
  }

  resetFailed(type: TranslationType): number {
    if (this.readOnly) return 0;
    const result = this.db
      .prepare(
        "DELETE FROM translation_progress_v2 WHERE namespace = ? AND type = ? AND status = 'failed'",
      )
      .run(this.namespace, type);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}
