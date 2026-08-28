import { AddPrimaryVietnameseSearch1721403500000 } from './1721403500000-AddPrimaryVietnameseSearch';

describe('AddPrimaryVietnameseSearch1721403500000', () => {
  it('creates accent folding and concurrent trigram indexes without a corpus table', async () => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
        return sql.includes('SELECT count(*)::int AS "count"')
          ? [{ count: 0 }]
          : [];
      }),
    } as any;

    const migration = new AddPrimaryVietnameseSearch1721403500000();
    await migration.up(runner);
    const sql = statements.join('\n');

    expect(migration.transaction).toBe(false);
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS unaccent');
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    expect(sql).toContain('dictionary_normalize_search');
    expect(sql).toContain('"definition_vi_normalized"');
    expect(sql).toContain('TRG_definitions_vi_search');
    expect(sql).toContain('LIMIT 10000');
    expect(sql).toContain('CREATE INDEX CONCURRENTLY');
    expect(sql).toContain('"IDX_definitions_vi_search_prefix_c"');
    expect(sql).toContain('COLLATE "C"');
    expect(sql).toContain('"definitions"');
    expect(sql).toContain('"learner_sense_translations"');
    expect(sql).not.toContain('CREATE TABLE');
  });
});
