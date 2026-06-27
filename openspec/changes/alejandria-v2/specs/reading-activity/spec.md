# reading-activity Specification

## Purpose

Mirrors the user's reading activity (notes, highlights, bookmarks, progress) across the user's Apple devices via iCloud Drive JSON files, replacing the MVP's HTTP-only sync. Each device owns its activity locally; iCloud Drive is the best-effort transport. Conflict resolution is last-write-wins by file mtime.

## Requirements

### Requirement: iCloud Drive transport

Activity MUST be synced via JSON files at `~/Library/Mobile Documents/com~apple~cloudDocs/Alejandria/activity/{notes,highlights,bookmarks,progress}/<book_uuid>.json`. Writes MUST go through `fsp.writeFile` (or the platform equivalent) to that path; reads MUST come from the same path. The system MUST NOT call any NAS endpoint to read or write activity.

#### Scenario: A note is written to iCloud Drive

- GIVEN the user creates a note on `book-042.epub` (UUID `abc`)
- WHEN the sync fires
- THEN a file `notes/abc.json` exists in `~/Library/Mobile Documents/com~apple~cloudDocs/Alejandria/activity/notes/`
- AND its body is the serialized note JSON
- AND no HTTP request is made to the NAS

#### Scenario: A progress update is written to iCloud Drive

- GIVEN the user reaches page 47 of `book-042.pdf`
- WHEN the debounced save fires
- THEN `progress/abc.json` exists at the iCloud path
- AND its body is the serialized progress JSON with `percentage = 0.45`

### Requirement: Last-write-wins by mtime

When a pull reads a cloud file and a local row, the system MUST keep the entry with the larger `updated_at` (or `last_read_at` for progress). Ties MUST be broken by lexicographic device id.

#### Scenario: Cloud wins because it is newer

- GIVEN local `notes/abc.json` has `updated_at = T0` and cloud has `updated_at = T1 > T0`
- WHEN the pull runs
- THEN the local row is replaced by the cloud payload
- AND `updated_at = T1` is stored locally

#### Scenario: Local wins because it is newer

- GIVEN local `updated_at = T2` and cloud has `updated_at = T1 < T2`
- WHEN the pull runs
- THEN the local row is preserved
- AND the cloud file is overwritten with the local payload on the next push

### Requirement: Pull triggers

Pull MUST run on three events: (a) app startup, (b) opening a specific book (`/reader/<id>` mount), (c) every 5 minutes while the app is foreground. Each pull iterates over the activity subdirs and reconciles every file present.

#### Scenario: Startup pull loads remote activity

- GIVEN the user opens the app on the iPad for the first time today
- WHEN startup pull runs
- THEN for every `*.json` in the iCloud `activity/{notes,highlights,progress,bookmarks}/` dirs
- AND the local row is reconciled against the cloud payload

#### Scenario: Opening a book pulls that book's activity

- GIVEN the user opens `book-042.epub` on the iPad
- WHEN the reader route mounts
- THEN `pullBook('book-042-id')` runs
- AND the local note/highlight/progress/bookmark sets for that book are reconciled

### Requirement: Push debounce

A push MUST be scheduled with a 2-second debounce after any activity mutation. Multiple mutations in the debounce window MUST coalesce into a single write. The debounce timer MUST be cleared and rearmed on each new mutation.

#### Scenario: Three rapid notes coalesce into one write

- GIVEN the user creates note 1, note 2, note 3 within 2 seconds
- WHEN the debounce settles
- THEN exactly one write to `notes/<book_uuid>.json` happens
- AND the file contains all three notes

### Requirement: Offline tolerance

If iCloud Drive is unreachable, the system MUST continue working offline. Local writes succeed; pending push writes are queued. When iCloud Drive returns, the queue drains.

#### Scenario: Disconnected iCloud does not crash the app

- GIVEN the user has no internet and iCloud Drive is offline
- WHEN the user creates a note
- THEN the local `annotations` row is written
- AND the push is queued
- AND no error toast appears

#### Scenario: Reconnection drains the queue

- GIVEN the push queue has 5 pending writes
- WHEN iCloud Drive becomes reachable
- THEN all 5 writes flush in order
- AND no data is lost

### Requirement: Book UUID match across devices

The book UUID in `<book_uuid>.json` MUST be the NAS `book.id` for downloaded books, and the local `book.id` for locally scanned books. Cross-device sync MUST work when the same NAS book is downloaded on both devices (UUIDs match by content_hash via `book_remote_links`).

#### Scenario: A downloaded book syncs across devices

- GIVEN the user downloads `Ficciones` from the NAS to the Mac (book UUID = NAS UUID)
- WHEN the user opens `Ficciones` on the iPad (also downloaded from the NAS)
- THEN both devices use the same UUID
- AND a note created on the Mac appears on the iPad within 5 seconds of opening the book

## Cross-references

- Depends on: `local-library-db` (rows to mirror), `book-reader` (mutation triggers)
- Consumed by: end users reading on multiple Apple devices
- Replaces: HTTP-only sync from the MVP `annotations` spec