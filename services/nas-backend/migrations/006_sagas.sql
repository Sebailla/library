-- 006_sagas.sql — sagas (book series) and book ↔ saga bridge.
--
-- A saga is a series of books by the same author. The
-- ``book_sagas`` bridge carries the order of the book within the
-- saga so the UI can render ``Book 1 / Book 3 / Book 2`` even when
-- the scanner inserts them out of order.
--
-- All statements are idempotent.

CREATE TABLE IF NOT EXISTS sagas (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT        NOT NULL,
  author_id   BIGINT      REFERENCES authors (id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT sagas_author_name_unique UNIQUE (author_id, name)
);

CREATE TABLE IF NOT EXISTS book_sagas (
  book_id    BIGINT NOT NULL REFERENCES books (id)  ON DELETE CASCADE,
  saga_id    BIGINT NOT NULL REFERENCES sagas (id)  ON DELETE CASCADE,
  ordinal    INT    NOT NULL DEFAULT 0,

  PRIMARY KEY (book_id, saga_id)
);

CREATE INDEX IF NOT EXISTS book_sagas_saga_id_idx
  ON book_sagas (saga_id);