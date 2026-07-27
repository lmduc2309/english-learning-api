// A Vietnamese value is "missing" if it is null/undefined, empty, or
// whitespace-only. The existing fillers only match IS NULL, so blank strings
// are invisible to them — this predicate (and its SQL forms) treat blanks as
// missing so the audit is honest and the normalize step can fix them.
export function isMissingVi(value: string | null | undefined): boolean {
  return value == null || value.trim() === '';
}

// SQL predicate for "missing" on a controlled column identifier (NULL or all-whitespace).
export function missingViSql(col: string): string {
  return `(${col} IS NULL OR ${col} !~ '\\S')`;
}

// SQL predicate for "blank but not NULL" (all-whitespace) — the subset fillers skip.
export function blankViSql(col: string): string {
  return `(${col} IS NOT NULL AND ${col} !~ '\\S')`;
}
