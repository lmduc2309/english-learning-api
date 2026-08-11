import { createLocalRequest, sha256, validateLocalRequest, validateLocalResult } from './protocol';
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
    const output = { headword: 'harbor', definition_en: 'A protected place where ships can stay.' };
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
});
