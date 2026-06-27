# local-library-db Specification

## Purpose

Stores the per-device library in a local SQLite database with FTS5, kept in sync with the NAS through a download-and-index pipeline. The local DB is the source of truth for offline browsing, reading activity (notes, highlights, progress, bookmarks), and per-device state. The NAS catalog is the source of truth for what books exist; the local DB is the source of truth for what the user has read on this device.

## Requirements

### Requirement: Single SQLite DB per device, not per library

The local DB MUST live at `<data_dir>/db.sqlite` and MUST contain a single `books` table with a `source` column (`'local_scan' | 'nas_download'`) instead of the MVP's per-library DB files. All other tables (`authors`, `categories`, `book_categories`, `annotations`, `reading_progress`, `bookmarks`, `sagas`, `book_sagas`, `books_fts`) live in the same file.

#### Scenario: Books from two sources coexist

- GIVEN the user has scanned a local folder and downloaded a book from the NAS
- WHEN the local catalog is read
- THEN both books appear in `books`
- AND their `source` column distinguishes them (`local_scan` vs `nas_download`)

#### Scenario: Only one DB file is opened

- GIVEN the app starts
- WHEN it opens the local store
- THEN exactly one file at `<data_dir>/db.sqlite` is opened
- AND no per-library DB files are created

### Requirement: FTS5 over title, author, excerpt, category path

The local DB MUST expose an FTS5 virtual table `books_fts(title, author_name, excerpt, category_path, content='books', content_rowid='rowid')` synced by triggers. Queries using `MATCH` MUST be answered in under 50 ms p95 on a 10,000-row table.

#### Scenario: FTS5 search returns ranked hits

- GIVEN 10,000 books are indexed locally
- WHEN the user types `fundación` in the search box
- THEN `SELECT title FROM books_fts WHERE books_fts MATCH 'fundación' ORDER BY rank LIMIT 20` returns matches in under 50 ms p95

#### Scenario: Inserts update the FTS index

- GIVEN a new row is inserted into `books`
- WHEN the trigger fires
- THEN the same `title + author_name + excerpt + category_path` is in `books_fts`

### Requirement: Notes, highlights, bookmarks, and progress tables live here

The local DB MUST own the activity tables (`annotations`, `reading_progress`, `bookmarks`) referenced by `book_id` from `books(id)`. These rows MUST NEVER be uploaded to the NAS. They MAY be mirrored to iCloud Drive JSON files via `reading-activity`.

#### Scenario: A note stays local

- GIVEN the user creates a note on `book-042.epub`
- WHEN the row is written
- THEN it lives in `<data_dir>/db.sqlite`
- AND no HTTP call to the NAS is made

#### Scenario: A progress row has the polymorphic last_position

- GIVEN the user reads `book-042.epub` to CFI `epubcfi(/6/4!/4/2/2/2/1:0)`
- WHEN the debounced save fires
- THEN `reading_progress.last_position = '{"epub":"cfi:epubcfi(/6/4!/4/2/2/2/1:0)"}'`
- AND `percentage = 0.55`

### Requirement: Schema mirrors NAS Postgres where overlap exists

The local `books` table MUST have the same columns as the NAS `books` table where the columns overlap (`id`, `title`, `author_id`, `year`, `format`, `file_path`, `content_hash`, `cover_path`, `categories`). The local table adds `source`, `source_book_id`, `download_id`, `download_completed` for tracking. Sync with the NAS is via the `content_hash` namespace.

#### Scenario: A downloaded book reuses NAS categories

- GIVEN the user downloads `Ficciones` from the NAS
- WHEN the local pipeline finishes
- THEN `books` has the same `id`, `title`, `author_id`, `categories` as the NAS payload
- AND `source = 'nas_download'` and `source_book_id` is the NAS book id

### Requirement: Cross-device progress match by content_hash

When the user opens a book that exists in iCloud Drive activity, the local DB MUST look up `progress-<contentHash>.json` and, if found, link the iCloud activity to the local book. The link MUST be stored in a `book_remote_links` table.

#### Scenario: Progress transfers between devices via iCloud

- GIVEN the user read `Ficciones` on the Mac to CFI X
- WHEN the user opens `Ficciones` on the iPad for the first time
- THEN the iPad reads `progress-<hash>.json` from iCloud Drive
- AND `book_remote_links` records the cross-device mapping
- AND the iPad reader resumes at CFI X

## Cross-references

- Depends on: nothing (local DB is sovereign)
- Consumed by: every UI capability (`library-browse-ui`, `library-search-ui`, `book-reader`, `reading-activity`, `reading-progress`)
- Synced from: NAS via `nas-browse-download`
- Synced to: iCloud Drive via `reading-activity` (best-effort, last-write-wins)