-- 014_books_library_id.sql — scope every book row to a library.
--
-- The catalog model in PR-N2 treats books as rows that belong to
-- exactly one library. The column is NULLABLE on purpose: the
-- MVP import path (one-shot data lift from the per-library
-- SQLite files) can land books before the library resolution is
-- known, and a backfill job will populate the column. The
-- service layer will eventually require ``library_id IS NOT
-- NULL`` for every public-facing book query; for PR-N2 the
-- filter is OPT-IN (callers may pass ``library_id`` to narrow
-- the result set, but they do not have to).
--
-- ``REFERENCES libraries(id)`` is intentionally WITHOUT
-- ``ON DELETE CASCADE`` — the libraries service refuses to
-- delete a library that still has books (409 LIBRARY_NOT_EMPTY)
-- so the FK only fires for empty libraries, and Postgres will
-- reject any other path (defence in depth).
--
-- The B-tree index on ``library_id`` keeps the per-library
-- list / count queries on the books endpoints cheap as the
-- catalog grows.
--
-- All statements are idempotent so the runner can re-apply this
-- file safely.

ALTER TABLE books ADD COLUMN IF NOT EXISTS library_id BIGINT REFERENCES libraries(id);
CREATE INDEX IF NOT EXISTS idx_books_library_id ON books(library_id);
