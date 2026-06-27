# reading-progress Specification

## Purpose

Stores and updates per-book reading progress in `local-library-db.reading_progress` with a polymorphic `last_position` payload. Normalises progress to `percentage ∈ [0, 100]` regardless of format. Triggers iCloud Drive mirror via `reading-activity`. Provides the resume affordance consumed by `book-reader`.

## Requirements

### Requirement: Polymorphic last_position

`reading_progress.last_position` MUST be a JSON string whose shape depends on `books.format`:
- PDF: `{"pdf": "page:N"}` where `N` is the 1-indexed page number.
- EPUB: `{"epub": "cfi:<CFI>"}` where `<CFI>` is an EPUB Canonical Fragment Identifier.
- Image: `{"image": {"zoom":Z, "x":X, "y":Y}}`.

The `last_position` column MUST never be null once the user opens a book.

#### Scenario: PDF page change persists

- GIVEN the user is reading `book-042.pdf` at page 47
- WHEN the debounced save fires
- THEN `last_position = '{"pdf":"page:47"}'`
- AND `current_page = 47`

#### Scenario: EPUB CFI change persists

- GIVEN the user is reading `book-042.epub` at CFI `epubcfi(/6/4!/4/2/2/2/1:0)`
- WHEN the debounced save fires
- THEN `last_position = '{"epub":"cfi:epubcfi(/6/4!/4/2/2/2/1:0)"}'`
- AND `current_position` mirrors the CFI string

### Requirement: Percentage normalisation

`percentage` MUST be in `[0, 100]` and MUST be computed as:
- PDF: `(current_page / total_pages) * 100`.
- EPUB: `cfiToPercentage(cfi, totalCfi)` where `totalCfi` is the last CFI of the spine.

The system MUST mark the book as `finished` when `percentage >= 99.5`.

#### Scenario: PDF percentage computation

- GIVEN a 100-page PDF and `current_page = 45`
- WHEN the row is written
- THEN `percentage = 45.0`

#### Scenario: EPUB CFI percentage computation

- GIVEN `cfi = "epubcfi(/6/4!/4/2/2/2/1:0)"` and `totalCfi = "epubcfi(/6/14!/4/2/2/2/1:0)"` (10 chapters, 1 chapter in)
- WHEN the row is written
- THEN `percentage ≈ 10.0`

#### Scenario: 99.5% threshold marks finished

- GIVEN `percentage = 99.6`
- WHEN the row is written
- THEN `finished_at IS NOT NULL`

### Requirement: total_pages and total_cfi stored once at indexing

`total_pages` for PDFs MUST be computed once when the book is indexed (via pymupdf on the sidecar). `total_cfi` for EPUBs MUST be computed once at indexing (last CFI of the spine). They MUST NOT be recomputed on every reader mount.

#### Scenario: total_pages is stable across reads

- GIVEN `book-042.pdf` has `total_pages = 263` indexed at scan time
- WHEN the reader mounts and reads the row
- THEN `total_pages = 263` regardless of any read events

### Requirement: One row per book, keyed by book_id

`reading_progress.book_id` MUST be PRIMARY KEY referencing `books(id) ON DELETE CASCADE`. There MUST NOT be multiple rows per book. INSERTs use `INSERT OR REPLACE` semantics.

#### Scenario: Re-opening a book updates the existing row

- GIVEN the user opens `book-042.epub` twice in the same session
- WHEN the second debounced save fires
- THEN only one row exists in `reading_progress` for `book_id = 'abc'`
- AND `last_read_at` is the latest timestamp

### Requirement: Cross-device sync via iCloud Drive

`reading_progress` rows MUST be mirrored to `progress/<book_uuid>.json` in iCloud Drive via `reading-activity`. The mirror MUST be triggered by the same debounced save that writes the local row. The mirror file MUST contain the entire `ReadingProgress` JSON.

#### Scenario: A progress update reaches iCloud within 5 s

- GIVEN the user reaches page 73 of `book-042.pdf` on the Mac
- WHEN the debounced save fires
- THEN `progress/<book_uuid>.json` exists in iCloud Drive within 5 s
- AND the file's `percentage = 73.0 / 263 * 100 ≈ 27.8`

### Requirement: Cross-format progress preservation

If the user reads `book-042` as a PDF on one device and as an EPUB on another, and the book ids map by `(title, author)` with fuzzy confidence, the system MUST offer a one-time prompt: "Match this book with your existing progress? (Y/N)". If accepted, the EPUB row inherits the PDF row's `current_page` percentage mapped onto the EPUB spine.

#### Scenario: Cross-format match preserves percentage

- GIVEN the user read `El Hobbit` as a PDF to 55% on the Mac
- WHEN the user opens the EPUB version on the iPad
- THEN a "Keep your 55% progress?" prompt is shown
- AND accepting it sets the EPUB row's `percentage = 55.0`
- AND declines leaves the EPUB row at `percentage = 0`

## Cross-references

- Depends on: `local-library-db` (row storage), `reading-activity` (iCloud mirror)
- Consumed by: `book-reader` (mounts resume affordance, debounced save)
- Replaces: per-library SQLite MVP reading-progress with polymorphic `last_position`