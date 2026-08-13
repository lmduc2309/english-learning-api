import * as fs from 'fs';

describe('full corpus campaign safety', () => {
  const source = fs.readFileSync(require.resolve('./campaign'), 'utf8');
  it('partitions remaining inventory into contiguous non-overlapping waves', () => {
    expect(source).toContain('offset += waveSize');
    expect(source).toContain("'--inventory-stride', '1'");
  });
  it('excludes every attempted calibration entry and stops on a failed wave', () => {
    expect(source).toContain('attemptedIds(wave)');
    expect(source).toContain('campaign stopped fail-closed');
  });
  it('defaults to one wave per invocation', () => {
    expect(source).toContain("positive('max-waves', 1)");
  });
  it('reports entry-level completion and the next resumable wave', () => {
    expect(source).toContain('remaining_entries: remainingEntries');
    expect(source).toContain('completion_percent:');
    expect(source).toContain('next_wave:');
  });
});
