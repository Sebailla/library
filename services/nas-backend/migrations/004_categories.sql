-- 004_categories.sql — bilingual taxonomy for the catalog.
--
-- Each category has a stable, URL-friendly ``path`` (e.g.
-- ``/ciencia/biologia``) plus human-readable names in Spanish and
-- English. The tree is self-referential via ``parent_id`` so
-- unlimited depth is supported; ``depth`` is denormalised so common
-- queries (breadcrumb rendering) don't need a recursive CTE.
--
-- ``category_aliases`` carries canonical ↔ synonym mappings used by
-- the scanner when an extracted category name doesn't match a known
-- path exactly. The pair (category_id, alias) is unique so the same
-- alias cannot be added twice for the same category.
--
-- All statements are idempotent.

CREATE TABLE IF NOT EXISTS categories (
  id          BIGSERIAL PRIMARY KEY,
  path        TEXT        NOT NULL UNIQUE,
  name_es     TEXT        NOT NULL,
  name_en     TEXT        NOT NULL,
  parent_id   BIGINT      REFERENCES categories (id) ON DELETE CASCADE,
  depth       INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS categories_parent_id_idx
  ON categories (parent_id);

CREATE TABLE IF NOT EXISTS category_aliases (
  category_id  BIGINT      NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  alias        TEXT        NOT NULL,
  locale       TEXT        NOT NULL DEFAULT 'es',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (category_id, alias, locale)
);