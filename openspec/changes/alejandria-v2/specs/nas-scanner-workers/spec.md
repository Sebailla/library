# nas-scanner-workers Specification

## Purpose

Indexes the NAS filesystem (`/share/biblioteca/raw/`, `.incoming/`, `.duplicates/`, `.corrupt/`, `.unsupported/`, `.needs_review/`) into the Postgres catalog via BullMQ workers that wrap the Python sidecar. Provides filesystem watcher + cron backup + manual admin trigger. Guarantees that a corrupt file never blocks the rest of the scan and that progress is observable via an admin status endpoint.

## Requirements

### Requirement: Filesystem watcher enqueues new files

The service MUST run a `watchdog` (or `inotify` equivalent) observer on `/share/biblioteca/raw/` and `/share/biblioteca/.incoming/`. When a new file lands, the observer MUST enqueue a BullMQ job `{path, sha256_hint}` on the `scan` queue within 5 seconds of the file appearing.

#### Scenario: A new PDF triggers an enqueue

- GIVEN the watcher is running and `/share/biblioteca/raw/Borges, Jorge Luis/` exists
- WHEN a new file `Ficciones (1944).epub` is copied into that folder
- THEN within 5 seconds a job appears on the `scan` queue with `path` set to the new file

#### Scenario: A burst of 100 files enqueues 100 jobs

- GIVEN the watcher is running
- WHEN 100 files are copied into the watched folder in parallel
- THEN 100 jobs are enqueued (one per file) within 30 seconds
- AND no jobs are dropped

### Requirement: BullMQ worker calls the sidecar

The service MUST run N BullMQ workers (N = CPU count) that consume the `scan` queue. Each worker MUST shell out to `alejandria extract <path>` and `alejandria ocr --backend vision <path>` as needed, MUST upsert the resulting row into `books` and `book_categories`, and MUST generate a cover thumbnail via pymupdf stored in `metadata/covers/<book_id>.jpg`.

#### Scenario: Successful scan persists a row

- GIVEN a job `{path: "..."}` is dequeued
- WHEN the worker runs the sidecar and parses the JSON
- THEN a row appears in `books` with `id = uuid`, `title`, `author`, `format`, `size_bytes`, `content_hash`, `cover_path`, `indexed_at`
- AND the cover file exists on disk

#### Scenario: Idempotent re-scan on the same hash

- GIVEN a row already exists for `content_hash = "abc"`
- WHEN the worker processes a job for a different path with the same hash
- THEN the existing row's `canonical_path` is preserved
- AND a new row appears in `book_copies` referencing the existing `book_id`

### Requirement: Errors are isolated, never blocking

A worker MUST catch every exception from the sidecar or DB upsert, MUST log the failure, MUST set `books.scan_status = 'failed'` and `books.scan_error = <message>` when the row was newly inserted, and MUST acknowledge the job so the queue keeps draining.

#### Scenario: A corrupt PDF does not halt the queue

- GIVEN the queue has 1,000 jobs and job #50 is a corrupted PDF
- WHEN job #50 fails with `pymupdf` raising
- THEN jobs #51 through #1,000 still run
- AND the row for job #50 has `scan_status = 'failed'` and `scan_error = "pymupdf: ..."`

### Requirement: Admin scan status endpoint

The service MUST expose `GET /api/admin/scan/status` (behind admin auth) returning `{state, processed, total, eta_seconds, queue_size, recent_errors}`. The endpoint MUST never block the scan workers.

#### Scenario: Status reports progress during a scan

- GIVEN 500 of 2,000,000 files have been processed
- WHEN the admin calls `GET /api/admin/scan/status`
- THEN the response is `{state: "scanning", processed: 500, total: 2000000, eta_seconds: ~160000, queue_size: 1999500, recent_errors: []}`

### Requirement: Cron backup sweep runs daily

The service MUST run a daily cron at 03:00 NAS-time that performs an incremental mtime-based scan over the watched folders, picking up files missed by the watcher. The cron MUST be configurable to skip or change schedule via env vars.

#### Scenario: A missed file is picked up by the cron sweep

- GIVEN the watcher missed an event for `book-999.epub` (inotify race)
- WHEN the cron sweep runs
- THEN a `scan` job is enqueued for that file
- AND the row appears in `books`

## Cross-references

- Depends on: `python-sidecar-cli` (CLI shim), `nas-catalog-service` (Postgres + Redis + BullMQ)
- Consumed by: admin tooling only; clients never call the scan API
- Side-effect: writes to `metadata/covers/`, `metadata/excerpts/` on the NAS filesystem