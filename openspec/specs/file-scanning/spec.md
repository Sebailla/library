# Especificación de Escaneo de Archivos

## Propósito

Walks a user-chosen root folder recursively and indexes every supported file into the active library's SQLite database with a memory profile that stays flat regardless of library size. Scans are incremental by default, survive app restarts, are cooperatively cancellable, and never block the UI search / browse flow.

## Requisitos

### Requisito: Escaneo streaming con perfil de memoria plano

The system MUST scan folders via a streaming generator pipeline that yields one file at a time and releases per-file references before yielding the next. The memory delta for scanning 10,000 files MUST stay under +30 MB from baseline (proven: 4,843 files in +4.4 MB).

#### Escenario: Escaneo de 10k archivos respeta el presupuesto de RAM

- DADO a library root with 10,000 mixed-format files
- CUANDO the user runs a full scan
- ENTONCES process RSS grows by less than 30 MB during the scan
- Y search and browse remain interactive throughout (no UI freeze >100 ms)

#### Escenario: Escaneo de 5.000 imágenes completa en menos de 2 minutos

- DADO a library root with 5,000 image files
- CUANDO a full scan runs on an M-series Mac
- ENTONCES the scan completes in under 2 minutes (wall clock)

### Requisito: Escaneo incremental por mtime

The system MUST perform an incremental scan by default: only files that are new (not in the DB) or whose filesystem `mtime` is newer than the stored `modified_at` are re-processed. Unchanged rows MUST be skipped at the SQL level.

#### Escenario: Re-correr el mismo escaneo no produce cambios

- DADO a library was scanned and 1,000 files are indexed
- CUANDO the user runs "Scan" again with no file modifications
- ENTONCES zero rows are inserted or updated in the `files` table
- Y zero new `indexed_at` values are written
- Y `seen` and `inserted` counters in the progress UI both equal zero (or "no changes")

#### Escenario: Un archivo modificado se re-procesa

- DADO a file `book.pdf` is in the DB with `modified_at = T0`
- CUANDO the user edits `book.pdf` (changing its content) and runs "Scan"
- ENTONCES the row for `book.pdf` is re-extracted, re-enriched, and its `indexed_at` is updated

### Requisito: Acciones explícitas de re-escaneo total y eliminación de archivos faltantes

The system MUST expose an explicit "Re-scan all" menu action (full rebuild) and a separate "Remove missing files" action. Files that no longer exist on disk MUST NOT be auto-purged during a normal scan; they require the explicit "Remove missing" action.

#### Escenario: Re-escanear todo re-procesa cada archivo

- DADO a library with 1,000 indexed files
- CUANDO the user selects "Re-scan all"
- ENTONCES every file in the library is re-extracted and re-enriched
- Y ISBNs that already have a non-null OpenLibrary blob are NOT re-fetched from the network (unless "Force refresh OpenLibrary" is also selected)

#### Escenario: Eliminar faltantes purga los archivos ausentes

- DADO a library with 100 indexed files, 5 of which no longer exist on disk
- CUANDO the user selects "Remove missing files"
- ENTONCES the 5 missing rows are deleted from the `files` table
- Y no rows are removed for files that still exist on disk

### Requisito: Cancelación cooperativa

The system MUST support cooperative cancellation of an in-flight scan. When the user clicks Cancel, the scanner MUST finish the file currently being processed and then stop; it MUST NOT abort mid-file.

#### Escenario: Cancelar permite que el archivo en curso termine

- DADO a scan is running and is mid-extraction of `book-042.pdf`
- CUANDO the user clicks the Cancel button
- ENTONCES `book-042.pdf` finishes processing (its row is written to the DB)
- Y the scanner stops before picking up `book-043.pdf`
- Y the progress UI disappears

### Requisito: Modo WAL para lectura/escritura concurrentes

The system MUST open the active library DB with SQLite WAL mode, autocommit, and `synchronous=NORMAL`. The scan (writer) and UI search/browse (readers) MUST be able to operate simultaneously without blocking each other.

#### Escenario: La búsqueda sigue funcionando durante un escaneo

- DADO a scan is running on a library
- CUANDO the user types a query in the search box
- ENTONCES the FTS5 query returns results in under 100 ms p95
- Y the query is not blocked by the scan's `INSERT OR REPLACE` statements

### Requisito: Escaneo en background con UX de progreso

The system MUST run scans as FastAPI background tasks and MUST report progress via SSE (server-sent events). The UI MUST show a small progress indicator by default and offer an expandable detail modal with counters (`seen`, `inserted`, `errors`, `skipped`), the current file path, a Cancel button, and a list of recent errors.

#### Escenario: El indicador de progreso se actualiza durante el escaneo

- DADO a scan is running
- CUANDO the scanner yields a `ScanProgress` event
- ENTONCES the sidebar progress pill increments the `seen` counter
- Y the detail modal (if open) updates `inserted`, `errors`, `skipped`, and the current file path

#### Escenario: El escaneo en background no congela la UI

- DADO a scan is in progress
- CUANDO the user clicks a library, runs a search, or opens a file
- ENTONCES the UI responds within 100 ms (no perceptible freeze)

## Referencias cruzadas

- Depends on: `library-registry` (needs active library context), `metadata-extraction`, `thumbnail-generation`, `openlibrary-enrichment`
- Consumed by: every read-side capability (no data without scan)