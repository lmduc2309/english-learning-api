import { GrantDsdOperationalMetadata1785629600000 } from './1785629600000-GrantDsdOperationalMetadata';
import { DSD_MIGRATIONS } from './index';

async function sqlOf(method: 'up' | 'down'): Promise<string> {
  const query = jest.fn().mockResolvedValue(undefined);
  await new GrantDsdOperationalMetadata1785629600000()[method]({ query } as any);
  return query.mock.calls.map(([sql]) => String(sql)).join('\n');
}

describe('operational migration metadata grants', () => {
  it('lets only the audit and backup roles read the migration ledger', async () => {
    const sql = await sqlOf('up');
    expect(sql).toMatch(/GRANT SELECT ON "dsd_migrations" TO dsd_auditor/);
    expect(sql).toMatch(/GRANT SELECT ON "dsd_migrations" TO dsd_backup/);
    expect(sql).not.toMatch(/TO dsd_app|TO dsd_curator/);
  });

  it('remains immediately after hardening and before later operational migrations', () => {
    const grant = DSD_MIGRATIONS.findIndex(
      (migration) => migration.name === 'GrantDsdOperationalMetadata1785629600000',
    );
    expect(DSD_MIGRATIONS[grant - 1]?.name).toBe(
      'HardenDsdCommercialBoundary1785629500000',
    );
    expect(DSD_MIGRATIONS[grant + 1]?.name).toBe(
      'AddDsdGenerationJobs1785629700000',
    );
  });

  it('revokes exactly those grants on local rollback', async () => {
    const sql = await sqlOf('down');
    expect(sql).toMatch(/REVOKE SELECT ON "dsd_migrations" FROM dsd_auditor/);
    expect(sql).toMatch(/REVOKE SELECT ON "dsd_migrations" FROM dsd_backup/);
  });
});
