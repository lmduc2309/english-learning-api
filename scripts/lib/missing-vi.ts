// A Vietnamese value is "missing" if it is null/undefined, empty, or
// whitespace-only. The existing fillers only match IS NULL, so blank strings
// are invisible to them — this predicate (and its SQL forms) treat blanks as
// missing so the audit is honest and the normalize step can fix them.
export function isMissingVi(value: string | null | undefined): boolean {
  return value == null || value.trim() === '';
}

// SQL predicate for "missing" on a controlled column identifier (NULL or blank).
export function missingViSql(col: string): string {
  return `(${col} IS NULL OR btrim(${col}) = '')`;
}

// SQL predicate for "blank but not NULL" — the subset the fillers silently skip.
export function blankViSql(col: string): string {
  return `(${col} IS NOT NULL AND btrim(${col}) = '')`;
}
