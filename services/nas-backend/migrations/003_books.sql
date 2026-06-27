-- 003_books.sql — books table.
--
-- One row per physical book file in the NAS catalog. The file_path
-- and content_hash are globally unique so the scanner can detect
-- duplicates before inserting.
--
-- author_id is nullable so books can be inserted before the author
-- row exists; the ingest pipeline resolves the link in a second
-- pass once the author is known.
--
-- indexed_at is set on insert so the UI can show "catalogued N days
-- ago" without needing a separate event log in this slice.
--
-- All statements are idempotent.

CREATE TABLE IF NOT EXISTS books (
  id                BIGSERIAL PRIMARY KEY,
  title             TEXT        NOT NULL,
  author_id         BIGINT      REFERENCES authors (id) ON DELETE SET NULL,
  year              INT,
  language          TEXT,
  format            TEXT,
  file_path         TEXT        NOT NULL UNIQUE,
  file_size_bytes   BIGINT,
  content_hash      TEXT        UNIQUE,
  cover_path        TEXT,
  excerpt           TEXT,
  indexed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Look-ups by content_hash are the cross-device sync key (see
-- local-library-db spec); the unique index already covers them, so
-- no extra index is required here.