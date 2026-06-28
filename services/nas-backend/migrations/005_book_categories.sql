-- 005_book_categories.sql — many-to-many bridge between books and
-- categories.
--
-- A book can belong to several categories (a sci-fi novel is also
-- a "Novela"). The ``confidence`` column lets the scanner record how
-- sure the classification was (``1.0`` for human-assigned,
-- ``0.6-0.8`` for heuristic, etc.); ``source`` distinguishes the
-- pipeline that produced the link so it can be audited later.
--
-- The composite primary key prevents accidental duplicates for the
-- same (book, category) pair. All statements are idempotent.

CREATE TABLE IF NOT EXISTS book_categories (
  book_id     BIGINT NOT NULL REFERENCES books (id)        ON DELETE CASCADE,
  category_id BIGINT NOT NULL REFERENCES categories (id)  ON DELETE CASCADE,
  confidence  REAL,
  source      TEXT,

  PRIMARY KEY (book_id, category_id)
);

CREATE INDEX IF NOT EXISTS book_categories_category_id_idx
  ON book_categories (category_id);