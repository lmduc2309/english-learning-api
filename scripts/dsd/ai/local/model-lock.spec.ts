import * as fs from 'fs';
import * as path from 'path';
import {
  LocalModelLock, loadLocalModelLock, lockSha256, validateLocalModelLock,
} from './model-lock';

function validLock(): LocalModelLock {
  return JSON.parse(fs.readFileSync(
    path.resolve(process.cwd(), 'data/dsd/models/local-model-lock.json'), 'utf8',
  ));
}

describe('local model lock', () => {
  it('accepts the committed three-model architecture', () => {
    const lock = loadLocalModelLock();
    expect(lock.models).toHaveLength(3);
    expect(lockSha256(lock)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects mutable revisions', () => {
    const lock = validLock();
    lock.models[0].revision = 'main';
    expect(validateLocalModelLock(lock).join(' ')).toMatch(/40-character commit/i);
  });

  it('rejects community quantized artifacts', () => {
    const lock = validLock();
    (lock.runtime as any).community_quantized_artifacts_allowed = true;
    expect(validateLocalModelLock(lock).join(' ')).toMatch(/community quantized/i);
  });

  it('keeps TranslateGemma gated under Gemma Terms', () => {
    const lock = validLock();
    const translator = lock.models.find((model) => model.roles.includes('en_vi_translation'))!;
    translator.license = 'Apache-2.0';
    translator.gated = false;
    expect(validateLocalModelLock(lock).join(' ')).toMatch(/gated Gemma-license/i);
  });

  it('does not allow one model to author and independently critic English', () => {
    const lock = validLock();
    lock.models[0].roles.push('english_critic');
    expect(validateLocalModelLock(lock).join(' ')).toMatch(/assigned to both/i);
  });
});
