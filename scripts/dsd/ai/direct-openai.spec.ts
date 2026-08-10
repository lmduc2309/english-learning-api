import { InventoryRow } from '../inventory';
import {
  DEFAULT_DSD_MODEL,
  DIRECT_OPENAI_BASE_URL,
  buildBatchRequestLine,
  buildEntryInput,
  loadDirectOpenAiConfig,
  validateGeneratedEntry,
} from './direct-openai';

const row = (): InventoryRow => ({
  dsd_entry_id: '11111111-1111-4111-8111-111111111111',
  headword: 'rehearse',
  part_of_speech_expectation: 'verb',
  dsd_priority: '1',
  dsd_band: 'core',
  product_rationale: 'Useful for study and performance contexts.',
  author_contributor_id: 'DSD-O-001',
  authored_date: '2026-08-10',
  inventory_evidence_id: 'EV-INV-TEST',
  declaration_id: 'DSD-DECL-TEST',
});

describe('direct OpenAI DSD generation', () => {
  it('accepts only api.openai.com and a direct model identifier', () => {
    expect(loadDirectOpenAiConfig({ OPENAI_API_KEY: 'test' })).toMatchObject({
      baseURL: DIRECT_OPENAI_BASE_URL,
      model: DEFAULT_DSD_MODEL,
    });
    expect(() => loadDirectOpenAiConfig({
      OPENAI_API_KEY: 'test',
      DSD_OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
    })).toThrow(/OpenRouter/);
    expect(() => loadDirectOpenAiConfig({
      OPENAI_API_KEY: 'test',
      DSD_OPENAI_MODEL: 'openai/gpt-5.6-terra',
    })).toThrow(/router-style/);
  });

  it('never falls back to router credentials', () => {
    expect(() => loadDirectOpenAiConfig({
      LLM_API_KEY: 'router-key',
      OPENROUTER_API_KEY: 'router-key',
    })).toThrow(/OPENAI_API_KEY is required/);
  });

  it('builds input from DSD inventory context only', () => {
    expect(buildEntryInput(row())).toBe(
      'DSD headword: rehearse\n' +
      'Expected part of speech: verb\n' +
      'Product rationale: Useful for study and performance contexts.',
    );
    expect(buildEntryInput(row())).not.toMatch(/legacy|definition|translation|rank/i);
  });

  it('builds a Responses Batch line with strict structured output', () => {
    const line = buildBatchRequestLine(row(), DEFAULT_DSD_MODEL, {
      type: 'object',
      additionalProperties: false,
    });
    expect(line.custom_id).toBe('dsd-11111111-1111-4111-8111-111111111111');
    expect(line.url).toBe('/v1/responses');
    expect(line.body).toMatchObject({
      model: DEFAULT_DSD_MODEL,
      store: false,
      text: { format: { type: 'json_schema', strict: true } },
      metadata: { legacy_input_used: 'false' },
    });
    expect(JSON.stringify(line)).not.toMatch(/word_id|legacy_id|source_definition/i);
  });

  it('validates an output against the exact inventory item', () => {
    const output = {
      headword: 'rehearse',
      sense_key: 's1',
      part_of_speech: 'verb',
      definition_en: 'To practise something before presenting it.',
      translation_vi: 'luyện tập trước khi trình bày',
      example_en: 'We rehearse the play every evening.',
      example_vi: 'Chúng tôi tập vở kịch mỗi tối.',
      usage_labels: ['general'],
    };
    expect(validateGeneratedEntry(output, row())).toEqual([]);
    expect(validateGeneratedEntry({ ...output, headword: 'remember' }, row()).join(' '))
      .toMatch(/does not match inventory/);
    expect(validateGeneratedEntry({ ...output, part_of_speech: 'noun' }, row()).join(' '))
      .toMatch(/does not match expected/);
  });
});
