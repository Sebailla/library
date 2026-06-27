-- 008_pgroonga_indexes.sql — pgroonga full-text indexes.
--
-- pgroonga is the only Postgres-native FTS extension with Spanish +
-- CJK tokenization out of the box (see nas-catalog-service spec).
-- Each index is created with ``IF NOT EXISTS`` so re-running this
-- migration is a no-op, matching the idempotent contract of the
-- earlier files.
--
-- ``NormalizerAuto`` lets pgroonga handle diacritics and casing
-- consistently across Spanish and English content; ``TOKEN_FILTERS
-- 'stem_normalizer'`` would add English stemming, but we keep it
-- off so the same index works for Spanish/CJK without surprises.

CREATE INDEX IF NOT EXISTS books_title_pgroonga_idx
  ON books
  USING pgroonga (title)
  WITH (normalizer = 'NormalizerAuto');

CREATE INDEX IF NOT EXISTS books_excerpt_pgroonga_idx
  ON books
  USING pgroonga (excerpt)
  WITH (normalizer = 'NormalizerAuto');

-- ``content_text`` does not exist yet on the books table; it is
-- added in a follow-up PR (Phase 2.3) when the scanner starts
-- writing extracted full text. The pgroonga ``&@~`` operator on
-- ``title`` and ``excerpt`` covers the search experience for PR-2B.

-- Reference the ``pgroonga`` extension so ``make installcheck`` and
-- other static-analysis passes can confirm the dependency. The
-- extension itself is created in ``001_extensions.sql``.
COMMENT ON EXTENSION pgroonga IS 'Full-text search for alejandria NAS catalog (Spanish + CJK).';