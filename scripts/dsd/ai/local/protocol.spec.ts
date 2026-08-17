import {
  createLocalRequest, sha256, validateLocalRequest, validateLocalResult,
  validateStageOutput,
} from './protocol';
import { canonicalJson } from './model-lock';

function request() {
  return createLocalRequest({
    stage: 'english', modelId: 'qwen3-14b-mlx-dsd-generation',
    modelLockSha256: 'a'.repeat(64), promptId: 'DSD-LOCAL-ENGLISH-V1',
    prompt: 'Create one original learner entry.', schema: { type: 'object' },
    seed: 7, maxTokens: 400, temperatureMilli: 200,
    payload: { dsd_entry_id: 'entry-1', headword: 'harbor', expected_pos: 'noun' },
  });
}

describe('local inference protocol', () => {
  it('creates stable content-bound request identities', () => {
    expect(request()).toEqual(request());
    expect(validateLocalRequest(request())).toEqual([]);
  });

  it.each(['legacy_id', 'legacy_definition', 'reviewer_id', 'approved_at', 'similarity_text', 'reasoning'])
  ('rejects forbidden payload key %s recursively', (key) => {
    expect(() => createLocalRequest({
      stage: 'english', modelId: 'model', modelLockSha256: 'a'.repeat(64),
      promptId: 'prompt', prompt: 'prompt', schema: {}, seed: 1, maxTokens: 10,
      temperatureMilli: 0, payload: { nested: { [key]: 'forbidden' } },
    })).toThrow(/forbidden local-model input/i);
  });

  it('detects payload mutation after request creation', () => {
    const value = request();
    value.payload.headword = 'changed';
    expect(validateLocalRequest(value).join(' ')).toMatch(/payload hash mismatch/i);
  });

  it('accepts a hash-bound completed result', () => {
    const value = request();
    const output = {
      headword: 'harbor', part_of_speech: 'noun',
      definition_en: 'A protected place where ships can stay.',
      example_en: 'The boats returned to the harbor before dark.', usage_labels: [],
    };
    expect(validateLocalResult({
      protocol_version: 1, request_id: value.request_id, state: 'completed',
      model_id: value.model_id, model_lock_sha256: value.model_lock_sha256,
      prompt_sha256: value.prompt_sha256, schema_sha256: value.schema_sha256,
      input_sha256: value.input_sha256, output, output_sha256: sha256(canonicalJson(output)),
      input_tokens: 20, output_tokens: 15, elapsed_ms: 300,
    }, value)).toEqual([]);
  });

  it('rejects result provenance drift', () => {
    const value = request();
    const errors = validateLocalResult({
      protocol_version: 1, request_id: value.request_id, state: 'terminal_failure',
      model_id: 'other-model', model_lock_sha256: value.model_lock_sha256,
      prompt_sha256: value.prompt_sha256, schema_sha256: value.schema_sha256,
      input_sha256: value.input_sha256, input_tokens: 0, output_tokens: 0,
      elapsed_ms: 1, error_code: 'MODEL_FAILURE',
    }, value);
    expect(errors.join(' ')).toMatch(/model_id does not match/i);
  });

  it('rejects critic synonyms instead of silently repairing the enum', () => {
    expect(validateStageOutput('critic', {
      decision: 'accept', reason_codes: ['DEFINITION_ACCURATE'],
    }).join(' ')).toMatch(/decision is invalid/i);
  });

  it('requires canonical critic reason codes with decision-consistent cardinality', () => {
    expect(validateStageOutput('critic', {
      decision: 'repair', reason_codes: ['DEF_EXAMPLE_MISMATCH'],
    }).join(' ')).toMatch(/reason_codes are invalid/i);
    expect(validateStageOutput('critic', {
      decision: 'pass', reason_codes: ['LEXICAL_INVALID'],
    }).join(' ')).toMatch(/requires empty/i);
    expect(validateStageOutput('critic', {
      decision: 'repair', reason_codes: [],
    }).join(' ')).toMatch(/requires reason_codes/i);
  });

  it('keeps inventory critic codes separate from English critic codes', () => {
    expect(validateStageOutput('inventory_critic', {
      decision: 'repair', reason_codes: ['PROPER_NAME'],
    })).toEqual([]);
    expect(validateStageOutput('critic', {
      decision: 'repair', reason_codes: ['PROPER_NAME'],
    }).join(' ')).toMatch(/reason_codes are invalid/i);
  });

  it('accepts the strict TranslateGemma wrapper and rejects commentary keys', () => {
    expect(validateStageOutput('translate', { translation_vi: 'Một bến cảng an toàn.' })).toEqual([]);
    expect(validateStageOutput('translate', {
      translation_vi: 'Một bến cảng an toàn.', note: 'extra',
    }).join(' ')).toMatch(/only translation_vi/i);
  });

  it('rejects invented usage labels before package assembly', () => {
    expect(validateStageOutput('english', {
      headword: 'harbor', part_of_speech: 'noun',
      definition_en: 'A protected place where ships can stay.',
      example_en: 'The ship entered the harbor before dark.',
      usage_labels: ['common'],
    }).join(' ')).toMatch(/usage_labels are invalid/i);
  });

  it('requires common classifier ids to be a unique subset of request ids', () => {
    const value = createLocalRequest({ stage: 'common_classifier', modelId: 'critic', modelLockSha256: 'a'.repeat(64),
      promptId: 'common', prompt: 'classify', schema: {}, seed: 1, maxTokens: 100, temperatureMilli: 0,
      payload: { entries: [{ i: 1, headword: 'house' }, { i: 2, headword: 'zymurgy' }] } });
    const output = { common_ids: [1] };
    expect(validateLocalResult({ protocol_version: 1, request_id: value.request_id, state: 'completed', model_id: value.model_id,
      model_lock_sha256: value.model_lock_sha256, prompt_sha256: value.prompt_sha256, schema_sha256: value.schema_sha256,
      input_sha256: value.input_sha256, output, output_sha256: sha256(canonicalJson(output)), input_tokens: 1, output_tokens: 1, elapsed_ms: 1 }, value)).toEqual([]);
    const missing = { common_ids: [3] };
    expect(validateLocalResult({ protocol_version: 1, request_id: value.request_id, state: 'completed', model_id: value.model_id,
      model_lock_sha256: value.model_lock_sha256, prompt_sha256: value.prompt_sha256, schema_sha256: value.schema_sha256,
      input_sha256: value.input_sha256, output: missing, output_sha256: sha256(canonicalJson(missing)), input_tokens: 1, output_tokens: 1, elapsed_ms: 1 }, value).join(' ')).toMatch(/subset/i);
  });

  it('keeps batched English output bound to every input id and headword', () => {
    expect(validateStageOutput('english_batch', { entries: [{ dsd_entry_id: 'e1', headword: 'house', part_of_speech: 'noun',
      definition_en: 'A building where people live.', example_en: 'Their house is near the park.', usage_labels: [] }] })).toEqual([]);
  });
});
