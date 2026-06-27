# isbn-resolution-pipeline Specification

## Purpose

Resolves an ISBN for every book in the catalog using a seven-layer priority chain. ISBN is a soft rule: every book is indexed even if resolution fails, but the pipeline must exhaust all reasonable sources before giving up. Records which layer produced the resolution so re-runs can be tuned and so the user can audit.

## Requirements

### Requirement: Seven-layer resolution chain

The pipeline MUST attempt ISBN resolution in this fixed order, stopping at the first hit:
1. Embedded metadata (XMP for PDF, OPF for EPUB, core props for DOCX).
2. Regex over the first 50,000 characters of extracted text.
3. OpenLibrary search by title + author.
4. Google Books search by title + author.
5. Vision OCR on the rendered first page and back cover (Vision native on Mac, Tesseract elsewhere).
6. Unlimited-OCR cloud endpoint when configured (skipped silently otherwise).
7. National libraries fuzzy lookup (BNE, Library of Congress, BN Argentina).

#### Scenario: Embedded ISBN wins over text regex

- GIVEN an EPUB whose OPF declares ISBN `9788445074873` AND whose body text also contains a different 13-digit number
- WHEN the chain runs
- THEN the returned ISBN is `9788445074873`
- AND `isbn_resolutions.source = 'embedded'`

#### Scenario: Google Books fills in when OL misses

- GIVEN OL has no record but Google Books returns `978-0-13-409865-3` for the title+author query
- WHEN the chain runs
- THEN the returned ISBN is `9780134098653`
- AND `isbn_resolutions.source = 'googlebooks'`

### Requirement: Persisted resolution record

Every resolution attempt MUST write a row in `isbn_resolutions` with columns `(book_id PK, isbn, source, confidence, attempts, last_attempt_at, error)`. A book with no successful resolution MUST have `isbn IS NULL` and `source = 'none'`. The row MUST survive DB restarts.

#### Scenario: Successful resolution is persisted

- GIVEN a book has its ISBN resolved via layer 3 (OpenLibrary)
- WHEN the resolution returns
- THEN `isbn_resolutions` has one row with `isbn`, `source = 'openlibrary'`, `confidence = 1.0`

#### Scenario: Failure leaves a traceable row

- GIVEN all 7 layers fail
- WHEN the chain finishes
- THEN `isbn_resolutions` has one row with `isbn = NULL`, `source = 'none'`, `attempts = 7`
- AND the book is still indexed and browsable

### Requirement: Layer 6 is conditional

Layer 6 (Unlimited-OCR) MUST be skipped silently if `UNLIMITED_OCR_ENDPOINT` is unset or unreachable. The chain MUST NOT raise; it MUST just record `attempts = 5` after a failure and move to layer 7.

#### Scenario: Unlimited-OCR endpoint unset skips layer 6

- GIVEN the env var `UNLIMITED_OCR_ENDPOINT` is unset
- WHEN the chain runs
- THEN layer 6 is skipped
- AND `isbn_resolutions.attempts` is incremented by 0 for that layer

#### Scenario: Unlimited-OCR endpoint returns 5xx falls through

- GIVEN the endpoint returns HTTP 503
- WHEN the chain runs
- THEN layer 6 records the error in `isbn_resolutions.error`
- AND layer 7 still runs

### Requirement: Rate-limited retries

Layers 3, 4, and 7 MUST respect a token-bucket throttle (5 req/s shared) so the chain does not hammer upstream APIs. Each layer MUST have an independent retry policy with exponential backoff (max 3 attempts per layer, base delay 1 s, factor 2).

#### Scenario: A 100-book burst stays under the rate cap

- GIVEN the throttle is configured to 5 req/s
- WHEN 100 books are processed in parallel by the chain
- THEN at most 5 req/s are issued across layers 3, 4, and 7 combined
- AND the 100 resolutions complete within ~30 s

### Requirement: Periodic re-attempt

Books whose resolution failed MUST be retried monthly by a scheduled job. The retry MUST increment `attempts` and refresh `last_attempt_at`. The job MUST run during off-peak hours (02:00 NAS-time).

#### Scenario: Failed books are retried after 30 days

- GIVEN a book has `isbn_resolutions.last_attempt_at = T0` and `isbn IS NULL`
- WHEN the monthly job runs at T0 + 30 days
- THEN the chain runs again for that book
- AND `attempts` increases by 7 (one per layer)
- AND `last_attempt_at` updates to the current time

## Cross-references

- Depends on: `python-sidecar-cli` (vision OCR, text extract), `nas-catalog-service` (Postgres writes)
- Consumed by: `nas-scanner-workers` (invoked per indexed book)
- Soft rule: indexed even on resolution failure