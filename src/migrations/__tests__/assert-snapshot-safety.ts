/**
 * Shared guard for the dictionary-corpus-cleanup migrations.
 *
 * Rollback snapshots must fail when their table already exists. Both
 * `CREATE TABLE IF NOT EXISTS` and `ON CONFLICT DO NOTHING` silently accept a
 * stale or partial backup left behind by a failed run, which turns the rollback
 * source into a lie without raising anything.
 *
 * Every snapshot follows the same three-part shape: a `to_regclass` guard that
 * raises, then an unconditional CREATE TABLE, then an unconditional INSERT.
 */
export function assertSnapshotSafety(sql: string): void {
  expect(sql).not.toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+"?cleanup_/i);
  expect(sql).not.toMatch(
    /INSERT\s+INTO\s+"?cleanup_backup[\s\S]*?ON\s+CONFLICT\s+DO\s+NOTHING/i,
  );

  // Any snapshot the migration creates must be guarded first.
  if (/CREATE\s+TABLE\s+"?cleanup_/i.test(sql)) {
    expect(sql).toContain('to_regclass');
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'stale snapshot/i);
  }
}
