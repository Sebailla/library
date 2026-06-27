# library-search-ui Specification

## Purpose

Provides a unified search bar that returns results across the local library (FTS5 with `pg_trgm` fallback) and optionally the NAS catalog (pgroonga). Typing is debounced; results group by source ("In your library" / "On the NAS") with cover thumbnails. Clicking a result opens the appropriate reader or download flow.

## Requirements

### Requirement: Unified debounced search bar

The search bar MUST debounce input by 200 ms. The bar MUST show a results panel under the input within 50 ms of a return on warm cache. Results MUST be grouped into "In your library" (local) and "On the NAS" (remote) sections with a divider between them.

#### Scenario: Local + NAS results appear together

- GIVEN the user has "Fundación" in the local library AND the NAS catalog has "Segunda Fundación"
- WHEN the user types `fundación` in the search bar
- THEN the panel shows two sections:
  - "In your library" with "Fundación" by Asimov
  - "On the NAS" with "Segunda Fundación" by Asimov
- AND each row shows cover, title, author, and a "Download" button (NAS rows) or "Read" button (local rows)

#### Scenario: Debounce prevents flooding

- GIVEN the user types `fundación` rapidly
- WHEN each keystroke fires
- THEN no upstream call is made
- AND exactly one search fires 200 ms after typing stops

### Requirement: Local results use FTS5 + trigram fallback

Local search MUST first try `books_fts MATCH <query>`. If `MATCH` returns fewer than 5 rows, a second pass MUST run `LIKE %query%` against `title` and `author_name`. The combined result MUST be capped at 20 rows.

#### Scenario: Fuzzy match via LIKE falls back

- GIVEN the user types `fuciones` (typo)
- WHEN FTS5 returns 0 rows
- THEN the LIKE fallback runs
- AND the panel shows books with `title LIKE '%fuciones%'`

### Requirement: NAS results use pgroonga through the NasClient

NAS search MUST call `GET /api/search?q=<query>` on the paired NAS via `INasClient.search`. The endpoint MUST be debounced per-query (200 ms). NAS results MUST be cached in TanStack Query for 60 s.

#### Scenario: NAS pairing required for NAS results

- GIVEN no NAS is paired
- WHEN the user types in the search bar
- THEN the "On the NAS" section is hidden entirely
- AND no HTTP call to the NAS is attempted

#### Scenario: NAS response is cached

- GIVEN the user types `fundación`
- WHEN the same query is re-typed within 60 s
- THEN the cached TanStack Query result is returned
- AND no HTTP call to the NAS is made

### Requirement: Typing a category name filters the grid

If the query matches a category name (exact, case-insensitive, in either Spanish or English), the result panel MUST show a "Browse category: ..." row that navigates to `/library/browse?category=<id>` on click. The match MUST be looked up against `name_es`, `name_en`, and the `category_aliases` table.

#### Scenario: Typing "Zoología" shows a category row

- GIVEN the taxonomy has `name_es = 'Zoología'` for category `cat-zoo`
- WHEN the user types `zoología`
- THEN a row "Browse category: Ciencia > Biología > Zoología" appears at the top of the panel
- AND clicking it navigates to `/library/browse?category=cat-zoo`

### Requirement: Empty state is actionable

When the search returns zero hits locally AND remotely, the panel MUST show a single message: "No matches. Try a different spelling or check the NAS pairing." with a link to NAS pairing settings.

#### Scenario: Zero hits shows actionable empty state

- GIVEN the user types `xyzqqqq` and no row matches
- WHEN the panel renders
- THEN the empty-state message appears
- AND a "Pair a NAS" link is present

## Cross-references

- Depends on: `local-library-db` (FTS5), `nas-catalog-service` (pgroonga), `category-taxonomy` (bilingual lookup)
- Consumed by: end users searching their library
- Layered in: MVC layer 1 (View) per refactor 04