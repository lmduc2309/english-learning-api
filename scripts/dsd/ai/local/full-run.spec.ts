import * as fs from 'fs';

describe('local full-run safety contract', () => {
  const source = fs.readFileSync(require.resolve('./full-run'), 'utf8');

  it('does not expose bulk approval or publication commands', () => {
    expect(source).not.toMatch(/command === ['"](?:approve-all|publish-all|reset)['"]/);
  });

  it('requires all production evidence and still stops for explicit import review', () => {
    expect(source).toContain("['backup-manifest', 'offhost-proof', 'restore-proof', 'authorization']");
    expect(source).toContain('production staging is intentionally not automatic');
  });

  it('uses an atomic state ledger and bounded repairs', () => {
    expect(source).toContain("fs.renameSync(temporary, file)");
    expect(source).toContain('revision <= state.max_repairs');
  });

  it('reports against the final immutable selection', () => {
    expect(source).toContain("calibration(['report', '--selection', p.selection");
  });

  it('fills an exact target only from a compatible immutable reserve package', () => {
    expect(source).toContain("if (base.entries.length + 1 !== target)");
    expect(source).toContain('incompatible reserve generation field');
    expect(source).toContain("'draft-package-final.json'");
  });

  it('records deterministic inventory sampling in the wave ledger', () => {
    expect(source).toContain("positiveInteger('inventory-stride', 1)");
    expect(source).toContain('inventory_offset: inventoryOffset');
    expect(source).toContain("'--stride', String(inventoryStride)");
  });
});
