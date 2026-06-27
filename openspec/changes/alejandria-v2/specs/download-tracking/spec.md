# download-tracking Specification

## Purpose

Records every download from the NAS into a `downloads` table on the Postgres side. The table is the source of truth for "what got downloaded, by which device, when" and powers the admin download statistics view. The client (Mac/iPad) is the source of truth for everything else; the NAS does not accept any other kind of write from a client.

## Requirements

### Requirement: Downloads table with per-device tracking

The service MUST maintain a `downloads` table with columns `(id BIGSERIAL PK, book_id UUID NOT NULL REFERENCES books(id), device_id UUID NOT NULL, device_name TEXT, user_id UUID, downloaded_at TIMESTAMPTZ DEFAULT NOW(), file_size_bytes BIGINT, bytes_transferred BIGINT, completed BOOLEAN DEFAULT FALSE, ip_address INET, user_agent TEXT)`. Indexes MUST exist on `(book_id)`, `(device_id)`, and `(downloaded_at)`.

#### Scenario: A download row is created on POST /api/downloads

- GIVEN the user clicks "Download" on a book
- WHEN the client POSTs `{book_id, device_id, device_name, file_size_bytes}`
- THEN a row appears in `downloads` with `id`, `bytes_transferred = 0`, `completed = false`

#### Scenario: Index speeds up stats queries

- GIVEN 100,000 download rows exist
- WHEN the admin runs `SELECT COUNT(*) FROM downloads WHERE book_id = X`
- THEN the query plan uses `idx_downloads_book`
- AND the response time is under 50 ms

### Requirement: PATCH marks completion or truncation

The client MUST call `PATCH /api/downloads/{id}` with `{completed: true, bytes_transferred: N}` when the download finishes, or `{completed: false, bytes_transferred: K, error: "..."}` when it aborts. The row MUST be updated atomically.

#### Scenario: A successful download is marked complete

- GIVEN a download row has `id = 42, completed = false`
- WHEN the client PATCHes `{completed: true, bytes_transferred: 5242880}`
- THEN the row has `completed = true, bytes_transferred = 5242880`
- AND `downloaded_at` is unchanged

#### Scenario: A truncated download is recorded

- GIVEN a download row has `id = 42, completed = false`
- WHEN the client PATCHes `{completed: false, bytes_transferred: 1000000, error: "user cancelled"}`
- THEN the row has `completed = false, bytes_transferred = 1000000`
- AND `error` is stored in a separate `download_errors` table

### Requirement: Admin-only stats endpoints

`GET /api/downloads/stats`, `GET /api/downloads/by-device/{device_id}`, and `GET /api/downloads/by-book/{book_id}` MUST require admin auth. They MUST return aggregate counts and last-N rows.

#### Scenario: Stats endpoint returns top books

- GIVEN 100,000 download rows exist
- WHEN the admin calls `GET /api/downloads/stats?limit=20`
- THEN the response is `{top_books: [{book_id, count}], top_devices: [{device_id, count}], total: 100000}`

#### Scenario: A non-admin gets 403

- GIVEN the requester has a non-admin token
- WHEN `GET /api/downloads/stats` is called
- THEN status is `403` and `code = "ADMIN_REQUIRED"`

### Requirement: Idempotent re-attempts

If the client retries a download that already finished, the NAS MUST return the same `download_id` and a `resume_supported` flag. The original row is preserved.

#### Scenario: Re-issued download returns the same id

- GIVEN download `id = 42` exists with `completed = true`
- WHEN the client POSTs the same `{book_id, device_id}` again
- THEN the response is `{download_id: 42, resume_supported: true}`
- AND no new row is created

### Requirement: Privacy boundary

The `downloads` table MUST NOT receive notes, highlights, progress, bookmarks, or any other reading activity from clients. Any attempt to write activity fields into the table MUST be rejected with `400 BAD_REQUEST`.

#### Scenario: Writing notes via downloads is rejected

- GIVEN the client POSTs `{book_id, device_id, ..., note: "private"}`
- WHEN the request reaches the server
- THEN status is `400` and `code = "DOWNLOADS_DO_NOT_ACCEPT_ACTIVITY"`

## Cross-references

- Depends on: `nas-catalog-service` (Postgres + auth)
- Consumed by: admin tooling (stats, dashboards)
- Side-effect: writes to `downloads` and (on error) `download_errors`; never anything else