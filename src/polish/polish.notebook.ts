import { PATTERNS } from './polish.catalog';
import { PolishCorrection } from './polish.types';

export interface NotebookSessionRow {
  id: string;
  rawText: string;
  editedText: string;
  createdAt: Date;
  corrections: PolishCorrection[];
}

export interface NotebookView {
  totalSessions: number;
  patterns: Array<{
    code: string;
    labelVi: string;
    kind: 'grammar' | 'natural';
    count: number;
    trend: 'up' | 'down' | 'flat' | 'new';
    weekly: Array<{ weekStart: string; count: number; sessions: number }>;
    examples: Array<{
      wrong: string;
      right: string;
      explanationVi: string;
      rawText: string;
      editedText: string;
      createdAt: string;
    }>;
  }>;
  tone: Array<{
    patternCode: string;
    labelVi: string;
    wrong: string;
    right: string;
    explanationVi: string;
    createdAt: string;
  }>;
}

const WEEKS = 12;
const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;
const OTHER_LABEL = 'Khác';

const mondayUtc = (d: Date): number => {
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY_MS;
};

const labelOf = (code: string): string =>
  PATTERNS.find((p) => p.code === code)?.labelVi ?? OTHER_LABEL;

export function buildNotebook(sessions: NotebookSessionRow[], now: Date): NotebookView {
  const lastWeek = mondayUtc(now);
  const starts = Array.from({ length: WEEKS }, (_, i) => lastWeek - (WEEKS - 1 - i) * WEEK_MS);
  const weekIndex = (d: Date): number => Math.floor((mondayUtc(d) - starts[0]) / WEEK_MS);

  const sessionsPerWeek = new Array<number>(WEEKS).fill(0);
  for (const s of sessions) {
    const i = weekIndex(s.createdAt);
    if (i >= 0 && i < WEEKS) sessionsPerWeek[i]++;
  }

  const newestFirst = [...sessions].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const groups = new Map<string, Array<{ c: PolishCorrection; s: NotebookSessionRow }>>();
  const tone: NotebookView['tone'] = [];
  for (const s of newestFirst) {
    for (const c of s.corrections) {
      if (c.kind === 'tone') {
        if (tone.length < 20) {
          tone.push({
            patternCode: c.patternCode,
            labelVi: labelOf(c.patternCode),
            wrong: c.wrong,
            right: c.right,
            explanationVi: c.explanationVi,
            createdAt: s.createdAt.toISOString(),
          });
        }
        continue;
      }
      const list = groups.get(c.patternCode) ?? [];
      list.push({ c, s });
      groups.set(c.patternCode, list);
    }
  }

  const rate = (counts: number[], from: number, to: number): { rate: number; sessions: number } => {
    const n = sessionsPerWeek.slice(from, to).reduce((a, b) => a + b, 0);
    const k = counts.slice(from, to).reduce((a, b) => a + b, 0);
    return { rate: n ? k / n : 0, sessions: n };
  };

  const patterns: NotebookView['patterns'] = [];
  for (const [code, items] of groups) {
    const counts = new Array<number>(WEEKS).fill(0);
    for (const { s } of items) {
      const i = weekIndex(s.createdAt);
      if (i >= 0 && i < WEEKS) counts[i]++;
    }
    const recent = rate(counts, 8, 12);
    const previous = rate(counts, 4, 8);
    let trend: 'up' | 'down' | 'flat' | 'new' = 'flat';
    if (previous.sessions === 0) trend = 'new';
    else if (recent.rate < previous.rate * 0.8) trend = 'down';
    else if (recent.rate > previous.rate * 1.2) trend = 'up';

    patterns.push({
      code,
      labelVi: labelOf(code),
      kind: items[0].c.kind === 'natural' ? 'natural' : 'grammar',
      count: items.length,
      trend,
      weekly: starts.map((start, i) => ({
        weekStart: new Date(start).toISOString().slice(0, 10),
        count: counts[i],
        sessions: sessionsPerWeek[i],
      })),
      examples: items.slice(0, 3).map(({ c, s }) => ({
        wrong: c.wrong,
        right: c.right,
        explanationVi: c.explanationVi,
        rawText: s.rawText,
        editedText: s.editedText,
        createdAt: s.createdAt.toISOString(),
      })),
    });
  }
  patterns.sort((a, b) => b.count - a.count);

  return { totalSessions: sessions.length, patterns, tone };
}
