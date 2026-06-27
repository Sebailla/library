# Especificación de Enriquecimiento con OpenLibrary

## Propósito

Augments locally extracted metadata with OpenLibrary's canonical bibliographic data (title, author, cover, description, tags) using a token-bucket-throttled HTTP client and a persistent retry queue. OpenLibrary failures are a first-class state: outages during a scan never block the scan, and lookups that fail are retried in the background until success or until a configurable max-attempt cap is reached.

## Requisitos

### Requisito: Cliente de OpenLibrary throttled con token bucket

The system MUST throttle OpenLibrary HTTP requests to at most 5 requests per second (token bucket) to avoid HTTP 429 rate limiting. The system MUST NOT issue concurrent OL requests for the same file.

#### Escenario: Una ráfaga de 50 ISBNs se throttlea

- DADO 50 ISBNs are queued for lookup
- CUANDO the scanner processes them in sequence
- ENTONCES the requests are spaced at least 200 ms apart
- Y no more than 5 requests per second are sent to `openlibrary.org`

#### Escenario: Un lookup de un solo ISBN usa una request

- DADO the scanner found ISBN `9780134098653` for a file
- CUANDO the OpenLibrary lookup runs
- ENTONCES exactly one HTTP request is issued to `https://openlibrary.org/api/books?bibkeys=ISBN:9780134098653`
- Y the response is cached on the file row

### Requisito: Los datos de OpenLibrary ganan sobre la extracción cruda

When OpenLibrary returns data for a field, the OL value MUST override the raw extractor value for that field on the indexed row. Fields not present in the OL response MUST retain the extractor value. The final indexed row is the union of (extractor) ∪ (OpenLibrary).

#### Escenario: OL sobrescribe el título del extractor

- DADO a PDF whose extractor returned title `Biology 11e`
- CUANDO OpenLibrary returns title `Campbell Biology`
- ENTONCES the indexed row records `Campbell Biology`
- Y the extractor title is discarded for that field

#### Escenario: Los campos faltantes de OL conservan los valores del extractor

- DADO a PDF whose extractor returned description `Local scan description`
- CUANDO OpenLibrary returns no description
- ENTONCES the indexed row keeps `Local scan description`

### Requisito: Cola persistente de reintentos para lookups fallidos

Failed OpenLibrary lookups (network errors, HTTP 5xx, timeouts) MUST persistse to a `pending_enrichment` table keyed by `(library_id, file_id, isbn)` and MUST NOT be retried in-line. A background worker MUST drain the queue with exponential backoff and a configurable max-attempt cap (default 5).

#### Escenario: Una falla de red durante el escaneo no lo bloquea

- DADO a scan is running and OpenLibrary is unreachable
- CUANDO the lookup for `9780134098653` fails with a network error
- ENTONCES the row is inserted into `pending_enrichment` with `attempts = 1`
- Y the scan continues to the next file without waiting

#### Escenario: El worker en background reintenta con backoff exponencial

- DADO a `pending_enrichment` row exists with `attempts = 2`
- CUANDO the background worker picks it up
- ENTONCES it waits `2^attempts * base_delay` (default `base_delay = 30s`) before retrying
- Y `attempts` is incremented to 3 on each retry

#### Escenario: El máximo de intentos marca la fila como permanentemente fallida

- DADO a `pending_enrichment` row with `attempts = 5` (default max)
- CUANDO the next retry fails
- ENTONCES the row is marked `permanently_failed`
- Y the worker MUST NOT pick it up again

### Requisito: La cola sobrevive a los reinicios

The `pending_enrichment` table MUST live in the per-library SQLite DB. The background worker MUST run on FastAPI startup and on a periodic timer. Pending retries MUST survive app restart without loss.

#### Escenario: Las filas pendientes sobreviven al reinicio de la app

- DADO the app is killed while 10 rows are pending in the queue
- CUANDO the app restarts
- ENTONCES the worker reads all 10 rows from the queue
- Y resumes retry processing

#### Escenario: Un reintento exitoso actualiza la fila del archivo

- DADO a `pending_enrichment` row for `book-042.pdf`
- CUANDO the background worker successfully fetches OpenLibrary data
- ENTONCES the OL data is merged into the `files` row
- Y the `pending_enrichment` row is deleted (or marked resolved)

### Requisito: OpenLibrary nunca es obligatorio

The system MUST allow a file to be fully indexed and browsable even when OpenLibrary enrichment never succeeds. Permanent failure of enrichment MUST NOT delete the file or block any other capability.

#### Escenario: Un archivo permanentemente fallido sigue siendo navegable

- DADO a file whose OL lookup was permanently failed
- CUANDO the user browses the library
- ENTONCES the file row is present with extractor metadata
- Y a status badge MAY show `enrichment failed` but the file is otherwise normal

## Referencias cruzadas

- Depends on: `metadata-extraction` (provides ISBN)
- Consumed by: `file-scanning` (called per-file)
- Queue table lives in the per-library DB created by `library-registry`