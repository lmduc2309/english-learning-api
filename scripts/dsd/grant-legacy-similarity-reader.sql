-- Least-privilege legacy input for the Task 8 compliance similarity audit.
--
-- Task 8 compares DSD-authored English against the legacy corpus to detect
-- overlap. It needs the English and nothing else. Rather than granting
-- read-only access to the legacy tables and trusting every future query to
-- stay in its lane, this exposes exactly one view and grants SELECT on only
-- that view.
--
-- The effect: dsd_similarity_reader is *physically incapable* of reading the
-- unlicensed tudien Vietnamese, the learner overlay, or any cleanup backup
-- table. The licensing boundary becomes a database permission rather than a
-- convention some future script forgets.
--
-- Deliberately absent from the view: every legacy row ID (so no DSD record can
-- ever carry one — invariant 1), definition_vi, example_vi, pronunciations,
-- learner_* tables, and cleanup_* tables.
--
-- Run as a superuser or the legacy owner against english_learning_db.
-- Idempotent: safe to re-run.

\set ON_ERROR_STOP on

BEGIN;

-- 1. Role. Created without login; the deploy assigns credentials separately so
--    no password ever appears in a committed file.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsd_similarity_reader') THEN
    CREATE ROLE dsd_similarity_reader NOLOGIN;
  END IF;
END $$;

-- 2. A schema the legacy application does not use, owned by the legacy owner.
CREATE SCHEMA IF NOT EXISTS dsd_compliance;

-- 3. The only object this role may read.
--
--    `content_digest` lets Task 8 store and compare a stable fingerprint
--    without ever persisting legacy text into DSD (invariant 4).
CREATE OR REPLACE VIEW dsd_compliance.english_similarity_input AS
  SELECT
    'definition'::text                       AS record_kind,
    w.word                                   AS headword,
    d.part_of_speech                         AS part_of_speech,
    d.definition_en                          AS content_en,
    md5(lower(btrim(d.definition_en)))       AS content_digest
  FROM definitions d
  JOIN words w ON w.id = d.word_id
  WHERE d.definition_en IS NOT NULL
    AND btrim(d.definition_en) <> ''
UNION ALL
  SELECT
    'example'::text                          AS record_kind,
    w.word                                   AS headword,
    d.part_of_speech                         AS part_of_speech,
    e.example_en                             AS content_en,
    md5(lower(btrim(e.example_en)))          AS content_digest
  FROM examples e
  JOIN definitions d ON d.id = e.definition_id
  JOIN words w       ON w.id = d.word_id
  WHERE e.example_en IS NOT NULL
    AND btrim(e.example_en) <> '';

COMMENT ON VIEW dsd_compliance.english_similarity_input IS
  'Sole legacy input for the DSD compliance similarity audit (Task 8). English only: '
  'no row IDs, no Vietnamese, no learner or cleanup tables. Widening this view '
  'widens the licensing boundary and requires compliance review.';

-- 4. Strip anything inherited. PUBLIC access on a legacy object would make the
--    grants below meaningless.
REVOKE ALL ON SCHEMA dsd_compliance FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA dsd_compliance FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM dsd_similarity_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM dsd_similarity_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM dsd_similarity_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM dsd_similarity_reader;

-- Future legacy tables must not become readable by default.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM dsd_similarity_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM dsd_similarity_reader;

-- 5. The complete allowlist: connect, see the compliance schema, read one view.
GRANT CONNECT ON DATABASE english_learning_db TO dsd_similarity_reader;
GRANT USAGE   ON SCHEMA dsd_compliance        TO dsd_similarity_reader;
GRANT SELECT  ON dsd_compliance.english_similarity_input TO dsd_similarity_reader;

COMMIT;
