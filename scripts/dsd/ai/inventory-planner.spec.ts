import {
  InventoryPlan,
  buildInventoryCellRequest,
  buildInventoryCells,
  stableDsdEntryId,
  validateCellCandidates,
  validateInventoryPlan,
} from './inventory-planner';

const plan: InventoryPlan = {
  plan_version: 1,
  plan_id: 'DSD-INVENTORY-PLAN-475153-20260810',
  target_id: 'DSD-TARGET-LEGACY-PARITY-20260809',
  active_target: 475_153,
  candidate_target: 550_000,
  candidates_per_cell: 100,
  levels: ['foundation', 'intermediate', 'advanced', 'academic', 'long-tail'],
  registers: ['general', 'specialist'],
  parts_of_speech: [
    'noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition',
    'conjunction', 'interjection', 'determiner', 'numeral', 'phrase',
  ],
  topics: Array.from({ length: 50 }, (_, index) => `topic-${index + 1}`),
  legacy_inventory_used: false,
};

const gridPlan: InventoryPlan = {
  ...plan,
  candidate_target: 4,
  candidates_per_cell: 1,
  levels: ['foundation'],
  registers: ['general'],
  parts_of_speech: ['noun', 'verb'],
  topics: ['home', 'work'],
};

describe('independent DSD inventory planner', () => {
  it('creates a stable Cartesian coverage plan without headwords', () => {
    expect(validateInventoryPlan(plan)).toEqual([]);
    expect(buildInventoryCells(plan)).toHaveLength(5_500);
    const cells = buildInventoryCells(gridPlan);
    expect(cells).toHaveLength(4);
    expect(cells[0]).toEqual({
      index: 0,
      id: 'DSD-INV-CELL-00001',
      level: 'foundation',
      register: 'general',
      partOfSpeech: 'noun',
      topic: 'home',
      count: 1,
    });
    expect(JSON.stringify(cells)).not.toMatch(/headword|legacy_id|word_id/);
  });

  it('builds a strict direct Responses request with no legacy input', () => {
    const request = buildInventoryCellRequest(buildInventoryCells(gridPlan)[0], 'gpt-5.6-terra', {
      type: 'object', additionalProperties: false,
    });
    expect(request.url).toBe('/v1/responses');
    expect(request.body).toMatchObject({
      model: 'gpt-5.6-terra',
      store: false,
      metadata: { legacy_input_used: 'false' },
    });
    expect(request.body.input).not.toMatch(/dictionary content|legacy word|source wording/i);
  });

  it('rejects duplicate, malformed, or wrong-POS candidates', () => {
    const cell = { ...buildInventoryCells(gridPlan)[0], count: 2 };
    const errors = validateCellCandidates({ candidates: [
      { headword: 'chair', part_of_speech: 'noun', product_rationale: 'Useful home object.' },
      { headword: 'Chair', part_of_speech: 'verb', product_rationale: 'Duplicate and wrong POS.' },
    ] }, cell).join(' ');
    expect(errors).toMatch(/duplicates/);
    expect(errors).toMatch(/wrong part of speech/);
  });

  it('derives stable UUIDv5-shaped IDs from DSD context only', () => {
    const id = stableDsdEntryId('  O’Clock ');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(stableDsdEntryId("o'clock")).toBe(id);
  });
});
