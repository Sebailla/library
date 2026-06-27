# nas-catalog-service Specification

## Purpose

Implements the NAS-side catalog service: NestJS HTTP API + Postgres + pgroonga FTS + Redis. Owns the canonical 2M-book catalog (read-only to clients) plus the download-tracking write surface. Replaces the MVP's FastAPI + per-library SQLite. Preserves the `{error:{code,message,details}}` envelope so the old MVP client can talk to the new backend during cutover.

## Requirements

### Requirement: NestJS service exposes the read-only catalog API

The service MUST expose `GET /api/search`, `GET /api/books/{id}`, `GET /api/books/{id}/categories`, `GET /api/files/{id}` (download, streaming + Range), `GET /api/categories`, and `GET /health`. Every response MUST follow the envelope `{data: ...}` on success or `{error: {code, message, details}}` on failure, with HTTP status matching the documented contract.

#### Scenario: Search returns paginated hits

- GIVEN 1,000 books are indexed and the term `fundación` matches 12 titles
- WHEN `GET /api/search?q=fundación&limit=20&offset=0` is issued
- THEN HTTP status is `200` and the body is `{data: {hits: [...], total: 12, limit: 20, offset: 0}}`

#### Scenario: Unknown book id returns the error envelope

- GIVEN no book has id `00000000-0000-0000-0000-000000000000`
- WHEN `GET /api/books/00000000-0000-0000-0000-000000000000` is issued
- THEN HTTP status is `404`
- AND the body is `{error: {code: "BOOK_NOT_FOUND", message: "...", details: {id: "..."}}}`

### Requirement: Postgres schema carries library_id everywhere

Every multi-row table (`books`, `authors`, `categories`, `book_categories`, `annotations` mirror, `reading_progress` mirror, `downloads`) MUST include a `library_id` column referencing `libraries(id)`. Primary keys MUST use `BIGSERIAL` or `UUID` depending on the table; integer foreign keys MUST be `BIGINT` (not `INTEGER`) to match the migrated volumes.

#### Scenario: Migration is idempotent on re-run

- GIVEN the migration script `migrations/0001_init.sql` was already applied
- WHEN a developer re-runs `npm run migrate`
- THEN no duplicate tables or indexes are created
- AND the script exits `0`

#### Scenario: A book row is associated with exactly one library

- GIVEN a book row exists in `books`
- WHEN the row is read
- THEN `library_id IS NOT NULL`
- AND `library_id` references a row in `libraries(id)`

### Requirement: pgroonga full-text index on books

The service MUST create a pgroonga index on `books.title`, `books.author_name`, and `books.excerpt`. Search queries via `/api/search` MUST use the pgroonga index for the `q` parameter and MUST support Spanish + CJK tokenization out of the box.

#### Scenario: 1,000-book query stays under 100 ms

- GIVEN 1,000 books are indexed
- WHEN `GET /api/search?q=fundación` is issued from a warm connection
- THEN p95 latency is under 100 ms
- AND the query plan reports index scan on the pgroonga index

#### Scenario: CJK search returns expected matches

- GIVEN a book with title `三体` is indexed
- WHEN `GET /api/search?q=三体` is issued
- THEN the response includes that book in `hits`

### Requirement: Download endpoint streams with Range support

`GET /api/files/{id}` MUST stream the raw book bytes, MUST honour `Range` headers, and MUST return `206 Partial Content` on Range requests. The endpoint MUST require a valid bearer token issued by the pairing flow.

#### Scenario: Full download succeeds

- GIVEN the bearer token is valid and the book exists
- WHEN `GET /api/files/{id}` is issued without `Range`
- THEN status is `200 OK` and the body is the full file
- AND `Content-Length` matches `books.size_bytes`

#### Scenario: Range download resumes mid-file

- GIVEN the client has already downloaded 5 MB of a 10 MB file
- WHEN it issues `GET /api/files/{id}` with `Range: bytes=5242880-`
- THEN status is `206 Partial Content`
- AND `Content-Range: bytes 5242880-10485759/10485760` is set
- AND the body contains the second half

### Requirement: Pairing via PIN grants a per-device bearer token

The service MUST expose `POST /api/auth/pair` accepting `{pin, device_name}` and returning `{device_id, bearer_token}`. The bearer token MUST be required on all non-`/health` endpoints. The PIN MUST be rotated on each successful pair.

#### Scenario: Correct PIN issues a token

- GIVEN the NAS is in pairing mode with PIN `123456`
- WHEN `POST /api/auth/pair {pin: "123456", device_name: "iPad de Seba"}` is called
- THEN status is `200` and the body returns `{device_id: "uuid", bearer_token: "..."}`
- AND the PIN rotates immediately

#### Scenario: Wrong PIN is rejected

- GIVEN the NAS is in pairing mode with PIN `123456`
- WHEN `POST /api/auth/pair {pin: "000000", device_name: "X"}` is called
- THEN status is `401` and the body is the error envelope with `code = "BAD_PIN"`

## Cross-references

- Depends on: Postgres 16 with pgroonga extension, Redis for BullMQ
- Consumed by: `nas-scanner-workers` (writes here), `nas-discovery-auth` (issues tokens), `nas-browse-download` (reads + downloads)
- Reuses the same `{error:{code,message,details}}` envelope as the MVP FastAPI so the legacy client keeps working during cutover