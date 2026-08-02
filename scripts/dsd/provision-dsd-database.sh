#!/usr/bin/env bash
# Provision the DSD database, its roles, and the least-privilege legacy audit
# input. Production counterpart to create-workbench.sh.
#
# Idempotent by design: a normal re-run makes no changes and exits 0. It never
# drops, recreates, renames, reassigns, or re-credentials an existing database.
# Credential rotation is a separate, explicitly confirmed operation
# (--rotate-credentials), because a provisioning script that silently resets
# passwords is a provisioning script that will one day lock out production.
#
# Usage:
#   zsh scripts/dsd/provision-dsd-database.sh [plan|apply|status]
#   zsh scripts/dsd/provision-dsd-database.sh apply --rotate-credentials
#
# Credentials come from the environment, never from this file:
#   DSD_OWNER_PASSWORD_<ROLE>   e.g. DSD_PASSWORD_DSD_APP
set -euo pipefail

MODE="${1:-plan}"
ROTATE="${2:-}"

PGHOST="${DSD_DB_HOST:-localhost}"
PGPORT="${DSD_DB_PORT:-5432}"
ADMIN_USER="${DSD_ADMIN_USER:-postgres}"
DSD_DB="${DSD_DB_DATABASE:-dsd_corpus_db}"
LEGACY_DB="${DB_DATABASE:-english_learning_db}"

# Identifiers are interpolated into DDL, so they must be safe. Refuse anything
# that is not a plain lowercase identifier rather than attempting to quote it.
validate_identifier() {
  case "$1" in
    ''|*[!a-z0-9_]*)
      echo "ERROR: unsafe or empty identifier: '$1'" >&2
      exit 1
      ;;
  esac
}
validate_identifier "$DSD_DB"
validate_identifier "$LEGACY_DB"

norm() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | xargs; }
if [ "$(norm "$DSD_DB")" = "$(norm "$LEGACY_DB")" ]; then
  echo "ERROR: DSD_DB_DATABASE ('$DSD_DB') must not equal the legacy database ('$LEGACY_DB')." >&2
  exit 1
fi

DSD_LOGIN_ROLES=(dsd_migrator dsd_curator dsd_app dsd_auditor dsd_backup)

psql_admin() { psql -h "$PGHOST" -p "$PGPORT" -U "$ADMIN_USER" -X -q -v ON_ERROR_STOP=1 "$@"; }

password_for() {
  # DSD_PASSWORD_DSD_APP, DSD_PASSWORD_DSD_CURATOR, ...
  local var="DSD_PASSWORD_$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')"
  printf '%s' "${(P)var:-}" 2>/dev/null || eval "printf '%s' \"\${$var:-}\""
}

plan_line() { echo "  would $*"; }

case "$MODE" in
  plan|apply)
    [ "$MODE" = plan ] && echo "PLAN (no changes will be made):"

    # ── owner role ────────────────────────────────────────────────────────
    if psql_admin -d postgres -t -A -c \
         "SELECT 1 FROM pg_roles WHERE rolname='dsd_owner'" | grep -q 1; then
      echo "  dsd_owner exists"
    elif [ "$MODE" = plan ]; then
      plan_line "CREATE ROLE dsd_owner NOLOGIN"
    else
      psql_admin -d postgres -c "CREATE ROLE dsd_owner NOLOGIN"
      echo "  created dsd_owner"
    fi

    # ── login roles ───────────────────────────────────────────────────────
    for role in "${DSD_LOGIN_ROLES[@]}"; do
      pw="$(password_for "$role")"
      exists=$(psql_admin -d postgres -t -A -c "SELECT 1 FROM pg_roles WHERE rolname='$role'")

      if [ "$exists" = "1" ]; then
        if [ "$ROTATE" = "--rotate-credentials" ]; then
          if [ -z "$pw" ]; then
            echo "ERROR: --rotate-credentials given but no password for $role" >&2
            exit 1
          fi
          [ "$MODE" = apply ] && psql_admin -d postgres -c \
            "ALTER ROLE $role LOGIN PASSWORD '$pw'" && echo "  rotated $role"
        else
          echo "  $role exists (credential untouched)"
        fi
        continue
      fi

      if [ -z "$pw" ]; then
        echo "ERROR: $role does not exist and no password supplied (DSD_PASSWORD_$(printf '%s' "$role" | tr '[:lower:]' '[:upper:]'))" >&2
        exit 1
      fi
      if [ "$MODE" = plan ]; then
        plan_line "CREATE ROLE $role LOGIN"
      else
        psql_admin -d postgres -c "CREATE ROLE $role LOGIN PASSWORD '$pw'"
        echo "  created $role"
      fi
    done

    # dsd_migrator gets DDL through membership in the owner role rather than by
    # owning the database, so routine work never authenticates as the owner.
    [ "$MODE" = apply ] && psql_admin -d postgres -c "GRANT dsd_owner TO dsd_migrator"

    # ── database ──────────────────────────────────────────────────────────
    if psql_admin -d postgres -t -A -c \
         "SELECT 1 FROM pg_database WHERE datname='$DSD_DB'" | grep -q 1; then
      echo "  database $DSD_DB exists (left untouched)"
    elif [ "$MODE" = plan ]; then
      plan_line "CREATE DATABASE $DSD_DB OWNER dsd_owner"
    else
      psql_admin -d postgres -c "CREATE DATABASE $DSD_DB OWNER dsd_owner"
      echo "  created database $DSD_DB"
    fi

    if [ "$MODE" = apply ]; then
      psql_admin -d "$DSD_DB" -c \
        "REVOKE ALL ON DATABASE $DSD_DB FROM PUBLIC;
         REVOKE ALL ON SCHEMA public FROM PUBLIC;
         GRANT CONNECT ON DATABASE $DSD_DB TO dsd_migrator, dsd_curator, dsd_app, dsd_auditor, dsd_backup;
         GRANT USAGE ON SCHEMA public TO dsd_curator, dsd_app, dsd_auditor, dsd_backup;"

      # ── legacy audit input ──────────────────────────────────────────────
      echo "  applying legacy similarity reader grants ..."
      psql_admin -d "$LEGACY_DB" -f "$(dirname "$0")/grant-legacy-similarity-reader.sql" >/dev/null
      pw="$(password_for dsd_similarity_reader)"
      if [ -n "$pw" ]; then
        psql_admin -d "$LEGACY_DB" -c "ALTER ROLE dsd_similarity_reader LOGIN PASSWORD '$pw'"
      fi
      echo "Provisioning complete."
    fi
    ;;

  status)
    psql_admin -d postgres -P pager=off \
      -c "SELECT datname FROM pg_database WHERE datname IN ('$DSD_DB','$LEGACY_DB') ORDER BY 1;" \
      -c "SELECT rolname, rolcanlogin, rolsuper FROM pg_roles
           WHERE rolname LIKE 'dsd\\_%' ORDER BY 1;"
    psql_admin -d "$LEGACY_DB" -P pager=off \
      -c "SELECT grantee, privilege_type FROM information_schema.table_privileges
           WHERE table_schema='dsd_compliance' ORDER BY 1,2;"
    ;;

  *)
    echo "usage: $0 [plan|apply|status] [--rotate-credentials]" >&2
    exit 2
    ;;
esac
