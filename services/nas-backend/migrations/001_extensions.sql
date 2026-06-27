-- 001_extensions.sql — enable Postgres extensions required by the
-- alejandria NAS catalog.
--
-- pgroonga: full-text search with Spanish + CJK tokenization (used by
--   the books.search repository and by the /api/search endpoint later).
-- pgcrypto: digests for content_hash and other cryptographic helpers.
--
-- Both statements are idempotent so re-running this migration is safe.

CREATE EXTENSION IF NOT EXISTS pgroonga;

CREATE EXTENSION IF NOT EXISTS pgcrypto;