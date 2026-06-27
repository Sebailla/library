# category-taxonomy Specification

## Purpose

Defines a bilingual hierarchical taxonomy (Spanish + English) with confidence-weighted auto-assignment of books to category nodes. Supports recursive "all descendants" queries, fuzzy alias matching, and a user override that is never overwritten by automatic assignment.

## Requirements

### Requirement: Bilingual category schema

`categories` MUST have columns `(id, path, name_es, name_en, parent_id, depth)`. `path` is the canonical Spanish path with `/` separators (e.g. `Ciencia/Biología/Zoología`). A sibling `category_aliases(category_id, alias, language)` table MUST hold extra lookup strings in either language.

#### Scenario: A seed row exists for Zoología

- GIVEN the seed runs
- WHEN the row is inserted
- THEN `(id = "cat-zoo", path = "Ciencia/Biología/Zoología", name_es = "Zoología", name_en = "Zoology", parent_id = "cat-bio", depth = 2)` is present

#### Scenario: An alias maps an English variant

- GIVEN the seed for Zoología also inserts aliases
- WHEN the alias row is inserted
- THEN `(category_id = "cat-zoo", alias = "Zoology", language = "en")` is present

### Requirement: Recursive descendant query

`GET /api/categories/<id>/books` MUST return every book whose `book_categories.category_id` matches the node OR any descendant. The query MUST use a recursive CTE so a single SQL call returns the union.

#### Scenario: Selecting Biología returns Zoología books too

- GIVEN Biología has 250 books directly and Zoología (a descendant) has 12
- WHEN `GET /api/categories/cat-bio/books` is called
- THEN the response contains 250 + 12 = 262 book rows
- AND no duplicate rows appear

### Requirement: Confidence-weighted auto-assignment

When a book is indexed, the system MUST compute candidates from up to 5 layers and assign the highest-confidence candidate set:
- Layer 1 (embedded `<dc:Subject>`): confidence 1.0, source `embedded`.
- Layer 2 (OpenLibrary subjects): confidence 0.85, source `openlibrary`.
- Layer 3 (Google Books categories): confidence 0.80, source `googlebooks`.
- Layer 4 (title keyword inference): confidence 0.50, source `inference`.
- Layer 5 (default): confidence 1.0, category `Sin clasificar`, source `default`.

If a higher-confidence layer produces a result, lower-confidence layers MUST be skipped.

#### Scenario: Embedded subject wins

- GIVEN an EPUB declares `<dc:Subject>Zoology</dc:Subject>` and OpenLibrary also returns `["Zoology", "Science"]`
- WHEN the chain runs
- THEN the assigned categories are mapped from the embedded subjects only (source `embedded`, confidence 1.0)
- AND OpenLibrary is not consulted

#### Scenario: No signal defaults to Sin clasificar

- GIVEN a book has no metadata at all
- WHEN the chain runs
- THEN the assigned category is `Sin clasificar` (source `default`, confidence 1.0)

### Requirement: User override is sacred

If a user assigns a category to a book with `source = 'user'`, automatic re-categorisation MUST NOT overwrite that row. The system MUST skip any book with at least one user-sourced category on re-categorisation.

#### Scenario: User override survives re-run

- GIVEN the user assigned `Ciencia > Biología > Zoología` to a book with `source = 'user'`
- WHEN OpenLibrary enrichment re-runs and returns a different category
- THEN the user's row remains unchanged
- AND no new row is upserted for that book

#### Scenario: An auto-categorised book can be replaced

- GIVEN a book has only `source = 'inference'` rows
- WHEN OpenLibrary enrichment re-runs with higher confidence
- THEN the inference rows are replaced
- AND the new OL rows are inserted

### Requirement: Bilingual alias resolution for user search

User search queries MAY arrive in Spanish or English. The system MUST resolve a query against `name_es`, `name_en`, and `category_aliases.alias` (case-insensitive). A query that matches an alias MUST return the underlying category id.

#### Scenario: Searching "Zoology" finds Zoología

- GIVEN the alias `(category_id = "cat-zoo", alias = "Zoology", language = "en")` exists
- WHEN the user types `zoology` in the search box
- THEN the lookup returns `cat-zoo`
- AND the browse view filters to category `cat-zoo`

### Requirement: Multi-category assignment

A book MAY belong to multiple categories. The composite key `(book_id, category_id)` MUST be the primary key of `book_categories`. Inserting the same pair twice MUST be a no-op.

#### Scenario: A book is in two categories

- GIVEN the chain assigns `Ciencia > Biología` AND `Ciencia > Biología > Zoología`
- WHEN the inserts run
- THEN `book_categories` has two rows for the same book
- AND no constraint violation occurs

## Cross-references

- Depends on: `nas-catalog-service` (Postgres schema), `local-library-db` (mirrored locally)
- Consumed by: `library-browse-ui` (tree render), `library-search-ui` (alias lookup)
- Synced from: OpenLibrary subjects via `metadata-extraction`