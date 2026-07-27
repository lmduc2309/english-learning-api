import {
  parseImportTudienArgs,
  shouldPersistTudienUpdates,
  SOURCE_RISK_ACKNOWLEDGEMENT_FLAG,
} from './import-policy';

describe('tudien import policy', () => {
  it('defaults to a non-writing dry run', () => {
    const args = parseImportTudienArgs([]);

    expect(args).toMatchObject({ dryRun: true, write: false, sourceRiskAcknowledged: false });
    expect(shouldPersistTudienUpdates(args)).toBe(false);
  });

  it('allows writes only with both explicit safety flags', () => {
    const args = parseImportTudienArgs(['--write', SOURCE_RISK_ACKNOWLEDGEMENT_FLAG]);

    expect(args).toMatchObject({ dryRun: false, write: true, sourceRiskAcknowledged: true });
    expect(shouldPersistTudienUpdates(args)).toBe(true);
  });

  it('keeps the shared definition/example persistence gate closed without acknowledgement', () => {
    const dryRunArgs = parseImportTudienArgs([]);

    expect(
      shouldPersistTudienUpdates({
        ...dryRunArgs,
        dryRun: false,
        write: true,
        sourceRiskAcknowledged: false,
      }),
    ).toBe(false);
  });

  it('rejects --write without acknowledgement before any import work starts', () => {
    expect(() => parseImportTudienArgs(['--write'])).toThrow(SOURCE_RISK_ACKNOWLEDGEMENT_FLAG);
  });

  it('rejects an acknowledgement that is not paired with --write', () => {
    expect(() => parseImportTudienArgs([SOURCE_RISK_ACKNOWLEDGEMENT_FLAG])).toThrow('--write');
  });

  it('rejects contradictory write and dry-run modes', () => {
    expect(() =>
      parseImportTudienArgs(['--write', '--dry-run', SOURCE_RISK_ACKNOWLEDGEMENT_FLAG]),
    ).toThrow('cannot be used together');
  });

  it('keeps unsafe positional matching available for non-writing forensic inspection', () => {
    const args = parseImportTudienArgs(['--unsafe-positional-definitions', '--word', 'run']);

    expect(args).toMatchObject({
      dryRun: true,
      unsafePositionalDefinitions: true,
      word: 'run',
    });
    expect(shouldPersistTudienUpdates(args)).toBe(false);
  });

  it('requires source-risk acknowledgement for unsafe positional writes too', () => {
    expect(() => parseImportTudienArgs(['--write', '--unsafe-positional-definitions'])).toThrow(
      SOURCE_RISK_ACKNOWLEDGEMENT_FLAG,
    );
  });

  it('rejects invalid limits', () => {
    expect(() => parseImportTudienArgs(['--limit', '0'])).toThrow('positive integer');
    expect(() => parseImportTudienArgs(['--limit', 'not-a-number'])).toThrow('positive integer');
  });
});
