import { AddDsdReleaseBuilds1785629300000 } from './1785629300000-AddDsdReleaseBuilds';
import { DSD_ENTITIES } from '../dsd-corpus.datasource';

async function sqlOf(direction: 'up' | 'down'): Promise<string> {
  const query = jest.fn().mockResolvedValue(undefined);
  await new AddDsdReleaseBuilds1785629300000()[direction]({ query } as any);
  return query.mock.calls.map(([s]) => String(s)).join('\n');
}

function constraintText(sql: string, name: string): string {
  const start = sql.indexOf(name);
  expect(start).toBeGreaterThan(-1);
  const rest = sql.slice(start);
  const next = rest.indexOf('CONSTRAINT "', name.length);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('what a build record must carry', () => {
  it('records what was built', async () => {
    const sql = await sqlOf('up');
    for (const column of ['manifest_sha256', 'signature', 'signer_key_id', 'signature_algorithm']) {
      expect(sql).toMatch(new RegExp(`"${column}"`));
    }
  });

  it('records what it was built from, including the epoch', async () => {
    // Without SOURCE_DATE_EPOCH the build cannot be reproduced, which is the
    // only reason to build deterministically at all.
    const sql = await sqlOf('up');
    for (const column of [
      'source_database', 'source_migration', 'source_date_epoch',
      'similarity_policy_sha256', 'source_registry_sha256', 'tool_registry_sha256',
      'contributor_registry_sha256',
    ]) {
      expect(sql).toMatch(new RegExp(`"${column}"`));
    }
    expect(sql).toMatch(/CHK_dsd_release_build_epoch.*"source_date_epoch" > 0/s);
  });

  it('records what the audit concluded and what the package contains', async () => {
    const sql = await sqlOf('up');
    for (const column of ['audit_version', 'entry_count', 'sense_count', 'audio_asset_count', 'territories']) {
      expect(sql).toMatch(new RegExp(`"${column}"`));
    }
  });

  it('requires at least one territory', async () => {
    expect(await sqlOf('up')).toMatch(/array_length\("territories", 1\) > 0/);
  });

  it('requires an ed25519 signature and a named signer', async () => {
    const check = constraintText(await sqlOf('up'), 'CHK_dsd_release_build_signature');
    expect(check).toMatch(/"signature_algorithm" = 'ed25519'/);
    expect(check).toMatch(/"signer_key_id"/);
  });

  it('names no contributor and no evidence location', async () => {
    const sql = await sqlOf('up');
    for (const forbidden of ['authored_by', 'reviewed_by', 'evidence_id', 'private_key']) {
      expect(sql).not.toMatch(new RegExp(`"${forbidden}"`));
    }
  });
});

describe('a public build needs a public-eligible release', () => {
  it('says so in the schema', async () => {
    // The pilot cannot be published from here either.
    expect(await sqlOf('up')).toMatch(
      /"channel" <> 'public' OR "public_eligible" = true/,
    );
  });
});

describe('a build record is immutable', () => {
  it('refuses both update and delete', async () => {
    const sql = await sqlOf('up');
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON "dsd_release_builds"/);
    const fn = sql.match(/dsd_release_build_immutable[\s\S]*?\$fn\$;/)![0];
    expect(fn).toMatch(/build again to produce a new one/);
  });

  it('treats the same bytes for the same release as the same build', async () => {
    // A deterministic re-export must not accumulate rows.
    expect(await sqlOf('up')).toMatch(
      /UQ_dsd_release_build" UNIQUE \("release_id", "manifest_sha256"\)/,
    );
  });
});

describe('grants', () => {
  it('lets the curator insert but never update', async () => {
    const sql = await sqlOf('up');
    expect(sql).toMatch(/GRANT SELECT, INSERT ON "dsd_release_builds" TO dsd_curator/);
    expect(sql).not.toMatch(/UPDATE ON "dsd_release_builds"/);
  });

  it('grants the serving role nothing', async () => {
    // Which packages exist is not a customer-facing fact.
    expect(await sqlOf('up')).not.toMatch(/TO dsd_app/);
  });

  it('lets the auditor read', async () => {
    expect(await sqlOf('up')).toMatch(/GRANT SELECT ON "dsd_release_builds" TO dsd_auditor/);
  });
});

describe('registration', () => {
  it('registers the entity', () => {
    const names = (DSD_ENTITIES as Array<new () => unknown>).map((e) => e.name);
    expect(names).toContain('DsdReleaseBuild');
  });
});

describe('down', () => {
  it('drops only what it created', async () => {
    const sql = await sqlOf('down');
    expect(sql).toMatch(/DROP TABLE IF EXISTS "dsd_release_builds"/);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS dsd_release_build_immutable/);
    expect(sql).not.toMatch(/dsd_entries|dsd_senses/);
  });
});
