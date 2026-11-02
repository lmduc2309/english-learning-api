import { buildNotebook, NotebookSessionRow } from './polish.notebook';
import { PolishCorrection } from './polish.types';

// Wednesday 2026-10-28; ISO week starts Monday 2026-10-26.
const NOW = new Date('2026-10-28T10:00:00Z');
const DAY = 86400000;

const corr = (patternCode: string, kind: PolishCorrection['kind'] = 'grammar'): PolishCorrection => ({
  kind,
  patternCode,
  wrong: `wrong-${patternCode}`,
  right: `right-${patternCode}`,
  explanationVi: 'giai thich',
  minor: false,
});

let n = 0;
const session = (weeksAgo: number, corrections: PolishCorrection[] = [], extraMs = 0): NotebookSessionRow => ({
  id: `s${n++}`,
  rawText: 'raw',
  editedText: 'edited',
  createdAt: new Date(NOW.getTime() - weeksAgo * 7 * DAY + extraMs),
  corrections,
});

describe('buildNotebook', () => {
  it('returns empty view for no sessions', () => {
    expect(buildNotebook([], NOW)).toEqual({ totalSessions: 0, patterns: [], tone: [] });
  });

  it('keeps tone corrections out of patterns and in tone', () => {
    const view = buildNotebook([session(0, [corr('article'), corr('too_direct', 'tone')])], NOW);
    expect(view.patterns.map((p) => p.code)).toEqual(['article']);
    expect(view.tone).toHaveLength(1);
    expect(view.tone[0]).toMatchObject({ patternCode: 'too_direct', labelVi: 'Quá thẳng' });
  });

  it('counts, sorts by count desc and labels unknown codes as Khác', () => {
    const view = buildNotebook(
      [session(0, [corr('article'), corr('other')]), session(0, [corr('preposition'), corr('preposition')]), session(0, [corr('preposition')])],
      NOW,
    );
    expect(view.totalSessions).toBe(3);
    expect(view.patterns.map((p) => [p.code, p.count])).toEqual([
      ['preposition', 3],
      ['article', 1],
      ['other', 1],
    ]);
    expect(view.patterns[0]).toMatchObject({ labelVi: 'Giới từ', kind: 'grammar' });
    expect(view.patterns[2].labelVi).toBe('Khác');
  });

  it('buckets into 12 ISO weeks, Monday start, oldest first', () => {
    const view = buildNotebook(
      [session(0, [corr('article')]), session(0, [corr('article'), corr('article')]), session(2, [corr('article')])],
      NOW,
    );
    const weekly = view.patterns[0].weekly;
    expect(weekly).toHaveLength(12);
    expect(weekly[11]).toEqual({ weekStart: '2026-10-26', count: 3, sessions: 2 });
    expect(weekly[10]).toEqual({ weekStart: '2026-10-19', count: 0, sessions: 0 });
    expect(weekly[9]).toEqual({ weekStart: '2026-10-12', count: 1, sessions: 1 });
    expect(weekly[0].weekStart).toBe('2026-08-10');
  });

  it('puts a Sunday session in the preceding Monday week', () => {
    const sun = new Date('2026-10-25T23:00:00Z');
    const view = buildNotebook(
      [{ id: 'x', rawText: '', editedText: '', createdAt: sun, corrections: [corr('article')] }],
      NOW,
    );
    expect(view.patterns[0].weekly[10]).toMatchObject({ weekStart: '2026-10-19', count: 1 });
  });

  describe('trend', () => {
    it('is new when the previous 4 weeks have no sessions', () => {
      expect(buildNotebook([session(0, [corr('article')])], NOW).patterns[0].trend).toBe('new');
    });

    it('is down when the rate fell by more than 20%', () => {
      const view = buildNotebook([session(5, [corr('article'), corr('article')]), session(1, [corr('article')])], NOW);
      expect(view.patterns[0].trend).toBe('down');
    });

    it('is up when the rate rose by more than 20%', () => {
      const view = buildNotebook([session(5, [corr('article')]), session(1, [corr('article'), corr('article')])], NOW);
      expect(view.patterns[0].trend).toBe('up');
    });

    it('is flat when the rate is within 20%', () => {
      const view = buildNotebook([session(5, [corr('article')]), session(1, [corr('article')])], NOW);
      expect(view.patterns[0].trend).toBe('flat');
    });
  });

  it('limits examples to 3, newest first', () => {
    const view = buildNotebook(
      [0, 1, 2, 3, 4].map((w) => session(w, [{ ...corr('article'), wrong: `w${w}` }])),
      NOW,
    );
    expect(view.patterns[0].examples.map((e) => e.wrong)).toEqual(['w0', 'w1', 'w2']);
    expect(view.patterns[0].examples[0]).toMatchObject({ rawText: 'raw', editedText: 'edited' });
  });

  it('limits tone to the newest 20', () => {
    const sessions = Array.from({ length: 25 }, (_, i) => session(0, [{ ...corr('too_direct', 'tone'), wrong: `t${i}` }], -i * 1000));
    const view = buildNotebook(sessions, NOW);
    expect(view.tone).toHaveLength(20);
    expect(view.tone[0].wrong).toBe('t0');
  });
});
