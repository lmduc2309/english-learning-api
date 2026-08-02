#!/usr/bin/env bash
# Clone english_learning_db into a scratch database for migration rehearsal.
#
# Every migration in docs/superpowers/plans/2026-08-01-dictionary-corpus-cleanup.md
# runs here before it touches the real database.
#
# Usage: zsh scripts/db-rehearsal.sh [create|drop|counts]
set -euo pipefail

CONTAINER=dictionary-postgres
SRC=english_learning_db
DST=english_learning_rehearsal
DB_USER=dictionary_user
PW="$(grep -E '^DB_PASSWORD=' "$(dirname "$0")/../.env" | cut -d= -f2-)"

dex() { docker exec -e PGPASSWORD="$PW" -i "$CONTAINER" "$@"; }

counts_sql="select 'words' t, count(*) from words
   union all select 'definitions', count(*) from definitions
   union all select 'examples', count(*) from examples
   union all select 'pronunciations', count(*) from pronunciations
   order by 1;"

case "${1:-create}" in
  create)
    # CREATE DATABASE ... TEMPLATE requires no other session on the source.
    open_conns="$(dex psql -U "$DB_USER" -d postgres -X -t -A -c \
      "select count(*) from pg_stat_activity where datname='$SRC' and pid<>pg_backend_pid();")"
    if [ "$open_conns" -ne 0 ]; then
      echo "ERROR: $open_conns session(s) still connected to $SRC." >&2
      echo "Stop the API (npm run start:dev) and any psql sessions, then retry." >&2
      exit 1
    fi
    echo "Dropping any previous $DST ..."
    dex psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS $DST;"
    echo "Cloning $SRC -> $DST (reads ~1 GB) ..."
    dex psql -U "$DB_USER" -d postgres -X -q -c "CREATE DATABASE $DST TEMPLATE $SRC;"
    echo "Done."
    ;;
  drop)
    dex psql -U "$DB_USER" -d postgres -X -q -c "DROP DATABASE IF EXISTS $DST;"
    echo "Dropped $DST."
    ;;
  counts)
    for db in "$SRC" "$DST"; do
      echo "-- $db"
      dex psql -U "$DB_USER" -d "$db" -X -q -P pager=off -c "$counts_sql"
    done
    ;;
  *)
    echo "usage: $0 [create|drop|counts]" >&2
    exit 2
    ;;
esac
