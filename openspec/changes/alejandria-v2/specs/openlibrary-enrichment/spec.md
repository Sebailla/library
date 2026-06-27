# Delta for openlibrary-enrichment

## MODIFIED Requirements

### Requirement: Cliente de OpenLibrary throttled con token bucket

The system MUST throttle OpenLibrary requests to ≤5 req/s via a token bucket. The system MUST NOT issue concurrent OL requests for the same file.

(Previously: 5 req/s global. v2 splits the bucket per lookup source; layers 3 (OL), 4 (Google Books), 7 (national libs) share a 5 req/s budget; layers 5–6 are not subject to this throttle.)

#### Scenario: Una ráfaga de 50 ISBNs se throttlea

- GIVEN 50 ISBNs are queued
- CUANDO the scanner processes them
- ENTONCES requests are spaced ≥200 ms apart
- AND ≤5 req/s hit `openlibrary.org`

#### Scenario: Un lookup de un solo ISBN usa una request

- GIVEN ISBN `9780134098653` is found
- CUANDO the OL lookup runs
- ENTONCES exactly one HTTP request is issued
- AND the response is cached on the row

### Requirement: Los datos de OpenLibrary ganan sobre la extracción cruda

When OL returns a field, the OL value MUST override the raw extractor value. Missing OL fields retain the extractor value. The row is the union of (extractor) ∪ (OL).

(Previously: union semantics. v2 keeps the union but OpenLibrary is now layer 3, with Google Books as layer 4.)

#### Scenario: OL sobrescribe el título del extractor

- GIVEN extractor returned `Biology 11e`
- CUANDO OL returns `Campbell Biology`
- ENTONCES the row records `Campbell Biology`

#### Scenario: Los campos faltantes de OL conservan los valores del extractor

- GIVEN extractor returned `Local scan description`
- CUANDO OL returns no description
- ENTONCES the row keeps `Local scan description`

### Requirement: Cola persistente de reintentos para lookups fallidos

Failed OL lookups MUST persist to `pending_enrichment` keyed by `(library_id, file_id, isbn)`. A background worker MUST drain the queue with exponential backoff and a configurable max-attempt cap (default 5).

(Previously: per-library SQLite table. v2 moves the queue to shared Postgres on NAS; local device sees its own SQLite mirror.)

#### Scenario: Una falla de red durante el escaneo no lo bloquea

- GIVEN OL is unreachable
- CUANDO the lookup fails with a network error
- ENTONCES the row is inserted in `pending_enrichment` with `attempts = 1`
- AND the scan continues

#### Scenario: El worker en background reintenta con backoff exponencial

- GIVEN a row exists with `attempts = 2`
- CUANDO the worker picks it up
- ENTONCES it waits `2^attempts * base_delay` before retrying
- AND `attempts` is incremented to 3

#### Scenario: El máximo de intentos marca la fila como permanentemente fallida

- GIVEN `attempts = 5`
- CUANDO the next retry fails
- ENTONCES the row is marked `permanently_failed`
- AND the worker MUST NOT pick it up again

### Requirement: La cola sobrevive a los reinicios

The `pending_enrichment` table MUST live in Postgres on the NAS. The worker MUST run on app startup and on a periodic schedule.

(Previously: per-library SQLite. v2 stores in Postgres; BullMQ drains on startup and on a Redis-backed schedule.)

#### Scenario: Las filas pendientes sobreviven al reinicio de la app

- GIVEN 10 rows are pending
- CUANDO the app restarts
- ENTONCES the worker reads all 10 rows
- AND resumes retry processing

#### Scenario: Un reintento exitoso actualiza la fila del archivo

- GIVEN a `pending_enrichment` row for `book-042.pdf`
- CUANDO the worker fetches OL data successfully
- ENTONCES the data merges into the `files` row
- AND the `pending_enrichment` row is deleted

### Requirement: OpenLibrary nunca es obligatorio

A file MUST be fully indexed and browsable even when OL enrichment never succeeds. Permanent failure MUST NOT delete the file or block any other capability.

(Previously: never blocking. v2 keeps this invariant.)

#### Scenario: Un archivo permanentemente fallido sigue siendo navegable

- GIVEN a file whose OL lookup was permanently failed
- CUANDO the user browses
- ENTONCES the file row is present
- AND a status badge MAY show `enrichment failed`

## ADDED Requirements

### Requirement: 7-layer ISBN resolution priority chain

OL enrichment MUST run as layer 3 of `isbn-resolution-pipeline` and MUST NOT run if a higher-confidence layer has already resolved the ISBN.

#### Scenario: A book with embedded ISBN skips OL

- GIVEN an EPUB with `<dc:identifier>ISBN:9788445074873</dc:identifier>`
- CUANDO the chain runs
- ENTONCES OL is NOT called
- AND `isbn_resolutions.source = 'embedded'`

### Requirement: Google Books as secondary source

The system MUST query Google Books as layer 4 when OL has no match. The response MUST merge into the same `isbn_resolutions` row.

#### Scenario: Google Books fills in when OL misses

- GIVEN OL has no record for `(title, author)`
- CUANDO the chain reaches layer 4
- ENTONCES a Google Books request is issued
- AND the response is stored with `source = 'googlebooks'`

## Cross-references

- Depends on: `metadata-extraction` (provides ISBN or title+author)
- Consumed by: `file-scanning`
- Queue now lives in Postgres on NAS
- New dep: `isbn-resolution-pipeline`