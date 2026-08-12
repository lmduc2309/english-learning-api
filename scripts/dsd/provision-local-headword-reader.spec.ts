import * as fs from 'fs';
import * as path from 'path';

describe('local headword reader provisioner', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'provision-local-headword-reader.sh'), 'utf8');
  it('hard-codes the local container and database', () => {
    expect(source).toContain('CONTAINER="dictionary-postgres"');
    expect(source).toContain('DATABASE="english_learning_db"');
    expect(source).toContain('local host required');
  });
  it('grants one view and no base table', () => {
    expect(source).toContain('GRANT SELECT ON dsd_compliance.headword_inventory_input');
    expect(source).not.toMatch(/GRANT SELECT ON (ALL TABLES|public\.)/);
    expect(source).not.toContain('legacy_backup');
  });
});
