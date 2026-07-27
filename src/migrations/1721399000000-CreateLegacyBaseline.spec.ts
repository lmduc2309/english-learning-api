import { CreateLegacyBaseline1721399000000 } from './1721399000000-CreateLegacyBaseline';

describe('CreateLegacyBaseline1721399000000', () => {
  it('adopts or creates every pre-migration application table', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new CreateLegacyBaseline1721399000000();

    await migration.up({ query } as any);

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    for (const table of [
      'users',
      'words',
      'definitions',
      'examples',
      'pronunciations',
      'word_forms',
      'synonyms',
      'categories',
      'category_words',
      'word_lists',
      'verbal_mapping_sessions',
      'verbal_mapping_attempts',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
  });

  it('never drops adopted legacy data on rollback', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new CreateLegacyBaseline1721399000000();

    await migration.down();

    expect(query).not.toHaveBeenCalled();
  });
});
