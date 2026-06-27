# book-reader Specification

## Purpose

Mounts the in-app reader for a single book, dispatching to the PDF reader (`pdfjs-dist` + `react-pdf-highlighter`) or the EPUB reader (`epub.js`) based on `books.format`. Reads/writes reading activity (`reading_progress`, `annotations`, `bookmarks`) against `local-library-db`. Persists activity to iCloud Drive via `reading-activity`. Both readers are lazy-loaded via `next/dynamic({ ssr: false })` so they never appear in the catalog bundle.

## Requirements

### Requirement: Dispatch by format

The reader route MUST inspect `books.format` and render the PDF or EPUB reader accordingly. For unknown formats the route MUST render a "Reader not available" panel with the book's cover and metadata.

#### Scenario: PDF books open in the PDF reader

- GIVEN `book.format = 'pdf'`
- WHEN the route `/reader/<id>` mounts
- THEN `PdfReader` is rendered
- AND `pdfjs-dist` is loaded

#### Scenario: EPUB books open in the EPUB reader

- GIVEN `book.format = 'epub'`
- WHEN the route `/reader/<id>` mounts
- THEN `EpubReader` is rendered
- AND `epub.js` is loaded

### Requirement: Lazy loading excludes readers from the catalog bundle

The PDF and EPUB components MUST be imported through `next/dynamic({ ssr: false })`. The catalog grid bundle MUST NOT contain either library until the user opens a book.

#### Scenario: Catalog bundle has no reader code

- GIVEN the user is on `/library/browse`
- WHEN the network panel is inspected
- THEN no chunk matching `pdfjs-dist` or `epub.js` is fetched

#### Scenario: Opening a book fetches the reader chunk

- GIVEN the user clicks a book row
- WHEN the route navigates to `/reader/<id>`
- THEN a network request for the dynamic chunk fires
- AND the chosen reader renders within 2 s p95 on Mac

### Requirement: Resume affordance

On mount, the reader MUST check `reading_progress.last_position`. If present and `auto_resume` is OFF (default), the reader MUST show a "Continue on page X" or "Continue at CFI X" prompt. If `auto_resume` is ON, the reader MUST scroll to the saved position without prompting.

#### Scenario: Default prompt offers resume

- GIVEN `book.format = 'pdf'`, `last_position = '{"pdf":"page:47"}'`, `auto_resume = false`
- WHEN the reader mounts
- THEN page 1 is rendered
- AND a "Continue on page 47" banner is visible at the top

#### Scenario: Auto-resume skips the prompt

- GIVEN `auto_resume = true`
- WHEN the reader mounts
- THEN page 47 is rendered directly with no banner

### Requirement: Debounced progress save

The reader MUST debounce `last_position` writes by 1 second. On unmount, the reader MUST flush any pending write. The saved row MUST include `current_page` (PDF), `total_pages`, `current_chapter`, `current_position` (CFI for EPUB), `percentage`, `last_read_at`, and `device_id`.

#### Scenario: Page change saves after debounce

- GIVEN the user is reading a PDF and changes from page 10 to page 11
- WHEN 1 second passes without further page change
- THEN `reading_progress` is upserted with `current_page = 11`, `percentage = 0.11`, `last_read_at = now`

#### Scenario: Unmount flushes pending save

- GIVEN a page change is pending (debounce timer not fired)
- WHEN the user closes the reader route
- THEN the pending update is written before unmount
- AND `last_read_at` is current

### Requirement: Activity sync to iCloud Drive

Notes, highlights, bookmarks, and progress MUST be mirrored to iCloud Drive JSON files via `reading-activity` with a 2-second debounce. The reader MUST NOT block the UI on the iCloud write.

#### Scenario: A new note syncs to iCloud within 5 s

- GIVEN the user creates a note on `book-042.epub`
- WHEN 2 seconds pass without further edits
- THEN `notes/<book-042-id>.json` in iCloud Drive contains the note
- AND the local row in `annotations` is unchanged

### Requirement: Finished-book threshold

When `percentage >= 99.5`, the row MUST be marked with `finished_at = now`. Re-opening a finished book MUST clear `finished_at`.

#### Scenario: Reaching 99.5% marks the book as finished

- GIVEN the user is reading a book at 99.0%
- WHEN they advance past the threshold
- THEN `finished_at` is set to the current timestamp

#### Scenario: Reopening a finished book un-marks it

- GIVEN `finished_at IS NOT NULL`
- WHEN the reader mounts
- THEN `finished_at` is cleared
- AND the book shows as in-progress in the UI

## Cross-references

- Depends on: `local-library-db` (activity tables), `reading-activity` (iCloud sync), `nextjs-app-shell` (RSC + dynamic)
- Consumed by: end users opening a book
- Layered in: MVC layer 1 (View) per refactor 04