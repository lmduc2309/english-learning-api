import {
  DSD_ROLES,
  DSD_EXPECTED_USERNAME,
  DSD_RELEASE_CHANNELS,
  buildDsdCorpusConfig,
  requireDsdConnection,
  dsdMustBeAvailable,
} from './dsd-corpus.config';

const LEGACY_DB = 'english_learning_db';

function url(user: string, db = 'dsd_corpus_db', host = 'localhost', port = 5432) {
  return `postgres://${user}:secret@${host}:${port}/${db}`;
}

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    DB_DATABASE: LEGACY_DB,
    DSD_DB_DATABASE: 'dsd_corpus_db',
    DSD_RELEASE_CHANNEL: 'off',
    DSD_APP_DATABASE_URL: url('dsd_app'),
    DSD_CURATOR_DATABASE_URL: url('dsd_curator'),
    DSD_AUDIT_DATABASE_URL: url('dsd_auditor'),
    DSD_MIGRATOR_DATABASE_URL: url('dsd_migrator'),
    DSD_BACKUP_DATABASE_URL: url('dsd_backup'),
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe('buildDsdCorpusConfig — database separation', () => {
  it('accepts a fully configured environment', () => {
    expect(buildDsdCorpusConfig(env()).errors).toEqual([]);
  });

  it('refuses when the DSD database name equals the legacy database name', () => {
    const config = buildDsdCorpusConfig(env({ DSD_DB_DATABASE: LEGACY_DB }));
    expect(config.errors.join(' ')).toMatch(/must not equal the legacy database/i);
  });

  it('refuses even when the names differ only by case or padding', () => {
    for (const name of ['English_Learning_DB', ' english_learning_db ']) {
      const config = buildDsdCorpusConfig(env({ DSD_DB_DATABASE: name }));
      expect(config.errors.join(' ')).toMatch(/must not equal the legacy database/i);
    }
  });

  it.each(DSD_ROLES)('requires the %s URL to target the DSD database', (role) => {
    const key = `DSD_${role === 'audit' ? 'AUDIT' : role.toUpperCase()}_DATABASE_URL`;
    const config = buildDsdCorpusConfig(env({ [key]: url(DSD_EXPECTED_USERNAME[role], LEGACY_DB) }));
    expect(config.errors.join(' ')).toMatch(
      new RegExp(`${role}.*targets database '${LEGACY_DB}'`, 'i'),
    );
  });
});

describe('buildDsdCorpusConfig — role separation', () => {
  it.each(DSD_ROLES)('requires the %s URL to authenticate as its own role', (role) => {
    const key = `DSD_${role === 'audit' ? 'AUDIT' : role.toUpperCase()}_DATABASE_URL`;
    const config = buildDsdCorpusConfig(env({ [key]: url('dsd_owner') }));
    expect(config.errors.join(' ')).toMatch(
      new RegExp(
        `${role} URL uses role 'dsd_owner' but expected role '${DSD_EXPECTED_USERNAME[role]}'`,
        'i',
      ),
    );
  });

  it('rejects the app URL carrying the migrator credential', () => {
    // The specific escalation this guard exists to stop: the serving path
    // silently acquiring DDL rights.
    const config = buildDsdCorpusConfig(env({ DSD_APP_DATABASE_URL: url('dsd_migrator') }));
    expect(config.errors.join(' ')).toMatch(/app.*expected role 'dsd_app'/i);
  });

  it('rejects any DSD URL using a legacy credential', () => {
    const config = buildDsdCorpusConfig(
      env({ DSD_CURATOR_DATABASE_URL: url('dictionary_user') }),
    );
    expect(config.errors.join(' ')).toMatch(/curator.*expected role 'dsd_curator'/i);
  });
});

describe('requireDsdConnection — no silent fallback', () => {
  it('returns the requested role', () => {
    const config = buildDsdCorpusConfig(env());
    expect(requireDsdConnection(config, 'curator').username).toBe('dsd_curator');
  });

  it('throws rather than substituting another role when one is missing', () => {
    const config = buildDsdCorpusConfig(env({ DSD_CURATOR_DATABASE_URL: undefined }));
    expect(() => requireDsdConnection(config, 'curator')).toThrow(/curator.*not configured/i);
    // The others must still resolve — a missing role is not a global failure.
    expect(requireDsdConnection(config, 'app').username).toBe('dsd_app');
  });

  it('throws when the config carries validation errors, even if the role parsed', () => {
    const config = buildDsdCorpusConfig(env({ DSD_DB_DATABASE: LEGACY_DB }));
    expect(() => requireDsdConnection(config, 'app')).toThrow(/invalid/i);
  });
});

describe('release channel', () => {
  it('defaults to off when unset', () => {
    expect(buildDsdCorpusConfig(env({ DSD_RELEASE_CHANNEL: undefined })).releaseChannel).toBe('off');
  });

  it('rejects an unknown channel rather than guessing', () => {
    const config = buildDsdCorpusConfig(env({ DSD_RELEASE_CHANNEL: 'beta' }));
    expect(config.errors.join(' ')).toMatch(/unknown release channel 'beta'/i);
  });

  it('exposes exactly the three approved channels', () => {
    expect(DSD_RELEASE_CHANNELS).toEqual(['off', 'internal', 'public']);
  });

  it('requires DSD availability on internal and public, not on off', () => {
    expect(dsdMustBeAvailable('off')).toBe(false);
    expect(dsdMustBeAvailable('internal')).toBe(true);
    expect(dsdMustBeAvailable('public')).toBe(true);
  });
});
