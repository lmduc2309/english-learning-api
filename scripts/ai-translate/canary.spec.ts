import { CANARY_CASES, assertCanaryPassed, runCanary } from './canary';

describe('CANARY_CASES', () => {
  it('provides 20 fixed probes as the design specifies', () => {
    expect(CANARY_CASES).toHaveLength(20);
  });
});

describe('runCanary', () => {
  it('passes every case when the server returns real Vietnamese', async () => {
    const report = await runCanary(async () => 'một con chó', ['A dog.', 'A cat.']);

    expect(report.passed).toBe(2);
    expect(report.total).toBe(2);
    expect(report.failures).toEqual([]);
  });

  // This is the failure the canary exists to catch: llama.cpp drops the
  // language codes and the model echoes its English input back.
  it('catches a server echoing the English input back unchanged', async () => {
    const report = await runCanary(async (text) => text, ['A dog.']);

    expect(report.passed).toBe(0);
    expect(report.failures[0].reason).toBe('equals_english');
  });

  it('catches output that is neither English nor Vietnamese', async () => {
    const report = await runCanary(async () => 'Ein Hund.', ['A dog.']);

    expect(report.passed).toBe(0);
    expect(report.failures[0].reason).toBe('no_vietnamese_diacritics');
  });

  it('catches CJK contamination', async () => {
    const report = await runCanary(async () => '一只狗', ['A dog.']);

    expect(report.passed).toBe(0);
    expect(report.failures[0].reason).toBe('contains_cjk');
  });

  it('records a thrown request as a failure instead of aborting the sweep', async () => {
    const report = await runCanary(async (text) => {
      if (text === 'A dog.') throw new Error('connection refused');
      return 'một con mèo';
    }, ['A dog.', 'A cat.']);

    expect(report.passed).toBe(1);
    expect(report.failures[0].reason).toBe('request_failed');
  });

  it('reports which probe failed so the operator can reproduce it', async () => {
    const report = await runCanary(async (text) => text, ['A dog.']);

    expect(report.failures[0].english).toBe('A dog.');
    expect(report.failures[0].output).toBe('A dog.');
  });
});

describe('assertCanaryPassed', () => {
  it('accepts a sweep at the 95% threshold', () => {
    expect(() =>
      assertCanaryPassed({ passed: 19, total: 20, failures: [] }, 0.95),
    ).not.toThrow();
  });

  it('refuses to let the job start below the threshold', () => {
    expect(() => assertCanaryPassed({ passed: 18, total: 20, failures: [] }, 0.95)).toThrow(
      /canary/i,
    );
  });

  it('names the pass rate in the error so the log explains the abort', () => {
    expect(() => assertCanaryPassed({ passed: 10, total: 20, failures: [] }, 0.95)).toThrow(
      /10\/20/,
    );
  });

  it('refuses an empty sweep rather than treating zero probes as success', () => {
    expect(() => assertCanaryPassed({ passed: 0, total: 0, failures: [] }, 0.95)).toThrow(
      /no canary/i,
    );
  });
});
