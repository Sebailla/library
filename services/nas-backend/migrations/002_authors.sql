-- 002_authors.sql — authors table.
--
-- A book in the NAS catalog is owned by exactly one author (no
-- co-author rows in this slice; sagas are tracked separately via the
-- sagas + book_sagas tables shipped in migration 006).
--
-- The combination of lastname + firstname is unique so the ingest
-- pipeline can upsert an author by name without producing duplicates.
--
-- All statements are idempotent.

CREATE TABLE IF NOT EXISTS authors (
  id          BIGSERIAL PRIMARY KEY,
  lastname    TEXT NOT NULL,
  firstname   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT authors_name_unique UNIQUE (lastname, firstname)
);