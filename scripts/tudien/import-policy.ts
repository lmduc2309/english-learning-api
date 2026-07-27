export const SOURCE_RISK_ACKNOWLEDGEMENT_FLAG = '--acknowledge-unlicensed-source-risk';

export interface ImportTudienArgs {
  dryRun: boolean;
  write: boolean;
  sourceRiskAcknowledged: boolean;
  fillOnly: boolean;
  word: string | null;
  limit: number | null;
  unsafePositionalDefinitions: boolean;
}

/**
 * Parse and enforce the safety boundary for the legacy tudien source.
 *
 * The source archive does not state a reusable license and aggregates content
 * attributed to third-party dictionaries. Planning/inspection is therefore the
 * default. Persisting even exact-example matches requires two explicit flags.
 */
export function parseImportTudienArgs(argv: string[]): ImportTudienArgs {
  const has = (flag: string) => argv.includes(flag);
  const value = (flag: string): string | null => {
    const index = argv.indexOf(flag);
    return index !== -1 && index + 1 < argv.length ? argv[index + 1] : null;
  };

  const write = has('--write');
  const explicitDryRun = has('--dry-run');
  const sourceRiskAcknowledged = has(SOURCE_RISK_ACKNOWLEDGEMENT_FLAG);

  if (write && explicitDryRun) {
    throw new Error('Choose one mode: --write and --dry-run cannot be used together.');
  }

  if (write && !sourceRiskAcknowledged) {
    throw new Error(
      'Refusing to write from the legacy tudien source. Its archive has no explicit reusable license ' +
        'and aggregates third-party dictionary content. To proceed intentionally, pass both --write ' +
        `and ${SOURCE_RISK_ACKNOWLEDGEMENT_FLAG}.`,
    );
  }

  if (!write && sourceRiskAcknowledged) {
    throw new Error(`${SOURCE_RISK_ACKNOWLEDGEMENT_FLAG} is only valid together with --write.`);
  }

  const limitRaw = value('--limit');
  const limit = limitRaw == null ? null : Number(limitRaw);
  if (limitRaw != null && (!Number.isSafeInteger(limit) || (limit as number) <= 0)) {
    throw new Error('--limit must be a positive integer.');
  }

  return {
    dryRun: !write,
    write,
    sourceRiskAcknowledged,
    fillOnly: has('--fill-only'),
    word: value('--word'),
    limit,
    unsafePositionalDefinitions: has('--unsafe-positional-definitions'),
  };
}

/** Defense in depth for every persistence path, including exact examples. */
export function shouldPersistTudienUpdates(args: ImportTudienArgs): boolean {
  return args.write && args.sourceRiskAcknowledged && !args.dryRun;
}
