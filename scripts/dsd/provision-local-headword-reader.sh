#!/usr/bin/env bash
# Local-only, minimal headword reader. It cannot target production and does not
# create backup roles or grant access to any legacy base table.
set -euo pipefail

MODE="${1:-status}"
CONTAINER="dictionary-postgres"
DATABASE="english_learning_db"
OWNER="dictionary_user"
ROLE="dsd_headword_reader"
LOCAL_PASSWORD="${DSD_LOCAL_HEADWORD_PASSWORD:-dsd_local_headwords}"

# Hard guards: these values are deliberately not configurable. Also refuse a
# caller whose loaded environment describes a remote or differently named DB.
case "${DB_HOST:-localhost}" in localhost|127.0.0.1|::1) ;; *) echo "ERROR: local host required" >&2; exit 1 ;; esac
[ "${DB_DATABASE:-$DATABASE}" = "$DATABASE" ] || { echo "ERROR: local database must be $DATABASE" >&2; exit 1; }
[ "${DB_USERNAME:-$OWNER}" = "$OWNER" ] || { echo "ERROR: local owner must be $OWNER" >&2; exit 1; }

docker inspect "$CONTAINER" --format '{{json .Config.Labels}}' | grep -q 'english-learning-api' || {
  echo "ERROR: $CONTAINER is not the local english-learning-api container" >&2; exit 1;
}

if [ -f "$(dirname "$0")/../../.env" ]; then
  ADMIN_PASSWORD="$(grep -E '^DB_PASSWORD=' "$(dirname "$0")/../../.env" | cut -d= -f2-)"
else
  ADMIN_PASSWORD="${PGPASSWORD:-}"
fi

psql_local() {
  PGPASSWORD="$ADMIN_PASSWORD" docker exec -e PGPASSWORD -i "$CONTAINER" \
    psql -U "$OWNER" -d "$DATABASE" -X -q -v ON_ERROR_STOP=1 "$@"
}

case "$MODE" in
  apply)
    DSD_LOCAL_HEADWORD_PASSWORD="$LOCAL_PASSWORD" \
    PGPASSWORD="$ADMIN_PASSWORD" docker exec -e PGPASSWORD -e DSD_LOCAL_HEADWORD_PASSWORD -i "$CONTAINER" \
      psql -U "$OWNER" -d "$DATABASE" -X -q -v ON_ERROR_STOP=1 <<'SQL'
\getenv local_headword_password DSD_LOCAL_HEADWORD_PASSWORD
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsd_headword_reader') THEN
    CREATE ROLE dsd_headword_reader NOLOGIN;
  END IF;
END $$;
ALTER ROLE dsd_headword_reader LOGIN PASSWORD :'local_headword_password';
CREATE SCHEMA IF NOT EXISTS dsd_compliance AUTHORIZATION dictionary_user;
CREATE OR REPLACE VIEW dsd_compliance.headword_inventory_input AS
  SELECT word AS headword
    FROM public.words
   WHERE language = 'en' AND word IS NOT NULL AND btrim(word) <> '';
ALTER VIEW dsd_compliance.headword_inventory_input OWNER TO dictionary_user;
REVOKE ALL ON SCHEMA public FROM dsd_headword_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM dsd_headword_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM dsd_headword_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM dsd_headword_reader;
REVOKE ALL ON SCHEMA dsd_compliance FROM dsd_headword_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA dsd_compliance FROM dsd_headword_reader;
GRANT CONNECT ON DATABASE english_learning_db TO dsd_headword_reader;
GRANT USAGE ON SCHEMA dsd_compliance TO dsd_headword_reader;
GRANT SELECT ON dsd_compliance.headword_inventory_input TO dsd_headword_reader;
COMMIT;
SQL
    echo "Local headword-only reader provisioned."
    ;;
  status)
    psql_local -P pager=off -c \
      "SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname='$ROLE';
       SELECT table_schema, table_name, privilege_type
         FROM information_schema.role_table_grants
        WHERE grantee='$ROLE' ORDER BY 1,2,3;"
    ;;
  *) echo "usage: $0 [apply|status]" >&2; exit 2 ;;
esac
