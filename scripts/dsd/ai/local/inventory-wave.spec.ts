import * as fs from 'fs';

describe('local inventory wave', () => {
  const source = fs.readFileSync(require.resolve('./inventory-wave'), 'utf8');
  it('binds requests to independent plan cells', () => {
    expect(source).toContain('buildInventoryCells(plan)');
    expect(source).toContain('legacy_inventory_used: false');
  });
  it('requires surplus candidates to survive dedupe and critic', () => {
    expect(source).toContain('unique < target');
    expect(source).toContain('passed < target');
  });
  it('chunks large cells below the calibrated generation limit', () => {
    expect(source).toContain("integer('candidates-per-request', 25)");
    expect(source).toContain('candidatesPerRequest > 50');
  });
  it('supports broad partial-cell sampling to reduce cross-chunk duplication', () => {
    expect(source).toContain("integer('candidates-per-cell', plan.candidates_per_cell)");
    expect(source).toContain('candidatesPerCell - index * candidatesPerRequest');
  });
});
