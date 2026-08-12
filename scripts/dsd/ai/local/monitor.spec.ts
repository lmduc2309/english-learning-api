import { estimateEta, formatDuration, percentile } from './monitor';
import * as fs from 'fs';

describe('local corpus monitor metrics', () => {
  it('formats durations and calculates percentile', () => {
    expect(formatDuration(3661)).toBe('1h 1m');
    expect(percentile([100, 400, 200, 300], .95)).toBe(400);
  });
  it('estimates remaining time from completed work', () => {
    expect(estimateEta(100, 25, 250_000)).toBe(750);
    expect(estimateEta(100, 0, 0)).toBe(Number.POSITIVE_INFINITY);
  });
  it('uses a byte offset cache for append-only JSONL spools', () => {
    const source = fs.readFileSync(require.resolve('./monitor'), 'utf8');
    expect(source).toContain('const jsonlCache');
    expect(source).toContain('size - cached.offset');
  });
});
