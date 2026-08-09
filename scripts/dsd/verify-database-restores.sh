#!/usr/bin/env bash
# Restore rehearsal for both databases.
#
# A dump that has never been restored is not a backup. This takes a fresh
# snapshot-bound backup of each database, restores it into a uniquely named
# scratch database, and compares the restored content against the manifest
# captured from the same snapshot.
#
# Run on a schedule and before any public release. Task 2A requires a
# successful proof no older than DSD_RESTORE_MAX_AGE_HOURS at release time.
#
# Usage:
#   zsh scripts/dsd/verify-database-restores.sh [backup-dir]
set -euo pipefail

BACKUP_DIR="${1:-${DSD_BACKUP_DIR:-./backups}}"
DSD_DB="${DSD_DB_DATABASE:-dsd_corpus_db}"
LEGACY_DB="${DB_DATABASE:-english_learning_db}"
PROOF_LOG="$BACKUP_DIR/restore-proof.log"
PROOF_FILE="${DSD_BACKUP_PROOF_FILE:-$BACKUP_DIR/backup-proof.json}"
OFF_HOST="${DSD_VERIFY_OFF_HOST:-false}"

if [ "$OFF_HOST" != "true" ] && [ "$OFF_HOST" != "false" ]; then
  echo "DSD_VERIFY_OFF_HOST must be true or false" >&2
  exit 2
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "Restore rehearsal starting $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "  backup dir: $BACKUP_DIR"

failed=0
for db in "$DSD_DB" "$LEGACY_DB"; do
  echo ""
  echo "── $db ──"

  # Release/production rehearsal downloads the newest exact object versions
  # from off-host storage. Local development can still create a fresh snapshot
  # in place, but that mode never emits a commercial release proof.
  if [ "$OFF_HOST" = "true" ]; then
    prepare=(dsd:backup:download -- --database "$db" --out-dir "$BACKUP_DIR")
  else
    prepare=(dsd:backup -- --database "$db" --out-dir "$BACKUP_DIR")
  fi
  if ! npm run --silent "${prepare[@]}"; then
    echo "  BACKUP PREPARATION FAILED for $db" >&2
    failed=1
    continue
  fi

  if npm run --silent dsd:verify-restore -- --database "$db" --dir "$BACKUP_DIR"; then
    printf '%s\t%s\tPASS\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$db" >> "$PROOF_LOG"
  else
    printf '%s\t%s\tFAIL\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$db" >> "$PROOF_LOG"
    failed=1
  fi
done

echo ""
if [ "$failed" -ne 0 ]; then
  echo "Restore rehearsal FAILED. Do not release." >&2
  exit 1
fi

echo "Restore rehearsal passed for both databases."
echo "Proof recorded in $PROOF_LOG"

if [ "$OFF_HOST" = "true" ]; then
  npm run --silent dsd:backup:proof -- --dir "$BACKUP_DIR" --output "$PROOF_FILE"
  echo "Commercial release proof recorded in $PROOF_FILE"
else
  echo "Local-only mode: no commercial release proof was emitted."
fi
