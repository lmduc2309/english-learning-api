import { RemoveEmptyDefinitions1721403000000 } from './1721403000000-RemoveEmptyDefinitions';
import { assertSnapshotSafety } from './__tests__/assert-snapshot-safety';

function collect(fn: (m: RemoveEmptyDefinitions1721403000000, r: any) => Promise<void>) {
  const query = jest.fn().mockResolvedValue(undefined);
  const migration = new RemoveEmptyDefinitions1721403000000();
  return fn(migration, { query }).then(() => {
    const statements = query.mock.calls.map(([s]) => String(s));
    return {
      sql: statements.join('\n'),
      at: (re: RegExp) => statements.findIndex((s) => re.test(s)),
    };
  });
}

describe('RemoveEmptyDefinitions1721403000000', () => {
  it('backs up cascading examples before deleting their parent', async () => {
    const { sql, at } = await collect((m, r) => m.up(r));

    assertSnapshotSafety(sql);

    // examples.definition_id is ON DELETE CASCADE. 8448 of these definitions
    // carry examples that vanish unrecoverably with the parent.
    expect(at(/INSERT INTO "cleanup_backup_empty_definition_examples"/)).toBeLessThan(
      at(/DELETE FROM "definitions"/),
    );
    expect(at(/INSERT INTO "cleanup_backup_empty_definitions"/)).toBeLessThan(
      at(/DELETE FROM "definitions"/),
    );

    // Selection must be by stored flag, not by re-deriving the regex — the
    // flags were recomputed against dictionary-quality.ts and are canonical.
    expect(sql).toContain(`'empty_definition' = ANY`);
    expect(sql).not.toMatch(/is_learner_visible\s*=\s*true/i);
  });

  it('restores definitions before examples on rollback and resets sequences', async () => {
    const { sql, at } = await collect((m, r) => m.down(r));

    expect(at(/INSERT INTO "definitions"/)).toBeLessThan(at(/INSERT INTO "examples"/));
    for (const t of ['definitions', 'examples']) {
      expect(sql).toContain(`setval(pg_get_serial_sequence('${t}','id')`);
    }
  });
});
