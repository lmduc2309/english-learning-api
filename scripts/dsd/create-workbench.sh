#!/usr/bin/env bash
# Create an empty local DSD workbench: the database plus local equivalents of
# the Task 2A scoped roles.
#
# It never clones english_learning_db. There is no code path here that reads
# legacy content — invariant 2. The workbench starts empty and is filled only
# by DSD migrations and DSD authoring tools.
#
# Production provisioning is Task 2A's script, not this one.
#
# Usage: zsh scripts/dsd/create-workbench.sh [create|drop|status]
set -euo pipefail

CONTAINER="${DSD_PG_CONTAINER:-dictionary-postgres}"
SUPERUSER="${DSD_PG_SUPERUSER:-dictionary_user}"
DSD_DB="${DSD_DB_DATABASE:-dsd_corpus_db}"
LEGACY_DB="${DB_DATABASE:-english_learning_db}"
ENV_FILE="$(dirname "$0")/../../.env"

if [ -f "$ENV_FILE" ]; then
  PW="$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
else
  PW="${PGPASSWORD:-}"
fi

# Refuse the one mistake that would destroy the separation this whole plan
# rests on. Mirrors the guard in dsd-corpus.config.ts so it exists at both the
# provisioning and configuration layers.
if [ "$(printf '%s' "$DSD_DB" | tr '[:upper:]' '[:lower:]' | xargs)" = \
     "$(printf '%s' "$LEGACY_DB" | tr '[:upper:]' '[:lower:]' | xargs)" ]; then
  echo "ERROR: DSD_DB_DATABASE ('$DSD_DB') must not equal the legacy database ('$LEGACY_DB')." >&2
  exit 1
fi

dex() { docker exec -e PGPASSWORD="$PW" -i "$CONTAINER" "$@"; }
psql_db() { dex psql -U "$SUPERUSER" -d "$1" -X -q -v ON_ERROR_STOP=1 "${@:2}"; }

# Local-only passwords. Production credentials come from the deploy secret
# store via Task 2A, never from this script.
LOCAL_PW="${DSD_LOCAL_ROLE_PASSWORD:-dsd_local_dev}"

# Literal list rather than a variable: npm invokes this with zsh, which does
# not word-split unquoted parameters, so `for r in $ROLES` would pass the whole
# string as one argument.
DSD_LOGIN_ROLES=(dsd_migrator dsd_curator dsd_app dsd_auditor dsd_backup)
DSD_LOGIN_ROLES_CSV="dsd_migrator,dsd_curator,dsd_app,dsd_auditor,dsd_backup"

case "${1:-create}" in
  create)
    echo "Creating local DSD workbench '$DSD_DB' ..."

    # Roles first: the database is owned by dsd_owner.
    psql_db postgres -c "DO \$\$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dsd_owner') THEN
        CREATE ROLE dsd_owner NOLOGIN;
      END IF;
    END \$\$;"

    for role in "${DSD_LOGIN_ROLES[@]}"; do
      psql_db postgres -c "DO \$\$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='$role') THEN
          CREATE ROLE $role LOGIN PASSWORD '$LOCAL_PW';
        END IF;
      END \$\$;"
    done

    # dsd_migrator gets DDL through membership in the owner role rather than
    # by owning the database itself.
    psql_db postgres -c "GRANT dsd_owner TO dsd_migrator;"

    if dex psql -U "$SUPERUSER" -d postgres -X -t -A \
         -c "SELECT 1 FROM pg_database WHERE datname='$DSD_DB'" | grep -q 1; then
      echo "  database already exists; leaving it untouched."
    else
      psql_db postgres -c "CREATE DATABASE $DSD_DB OWNER dsd_owner;"
      echo "  created."
    fi

    psql_db "$DSD_DB" -c "GRANT CONNECT ON DATABASE $DSD_DB TO $DSD_LOGIN_ROLES_CSV;"
    echo "Done. Run 'npm run dsd:migration:run' to build the schema."
    ;;

  drop)
    # Workbench only. Never offered against a non-local host.
    psql_db postgres -c "DROP DATABASE IF EXISTS $DSD_DB;"
    echo "Dropped $DSD_DB."
    ;;

  status)
    dex psql -U "$SUPERUSER" -d postgres -X -P pager=off \
      -c "SELECT datname FROM pg_database WHERE datname IN ('$DSD_DB','$LEGACY_DB') ORDER BY 1;" \
      -c "SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname LIKE 'dsd\\_%' ORDER BY 1;"
    ;;

  *)
    echo "usage: $0 [create|drop|status]" >&2
    exit 2
    ;;
esac
