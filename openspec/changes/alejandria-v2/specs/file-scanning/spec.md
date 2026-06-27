# Delta for file-scanning

## MODIFIED Requirements

### Requirement: Escaneo streaming con perfil de memoria plano

The system MUST scan via a streaming generator that yields one file at a time and releases per-file references. Memory delta for 10,000 files MUST stay under +30 MB.

(Previously: identical invariant applied to local SQLite + FastAPI. Now applied on device via the Python sidecar and on NAS via BullMQ workers wrapping the same generator.)

#### Scenario: Escaneo de 10k archivos respeta el presupuesto de RAM

- GIVEN a library root with 10,000 mixed-format files
- CUANDO a full scan runs
- ENTONCES RSS grows by less than 30 MB
- Y search and browse remain interactive (>100 ms freezes blocked)

#### Scenario: Escaneo de 5.000 imágenes completa en menos de 2 minutos

- GIVEN a library root with 5,000 images
- CUANDO a full scan runs on M-series Mac
- ENTONCES the scan completes in under 2 minutes

### Requirement: Escaneo incremental por mtime

The system MUST perform an incremental scan by default: only new files or files whose `mtime` is newer than `modified_at` are re-processed. Unchanged rows MUST be skipped at SQL level.

(Previously: identical. Now also applied on NAS: NAS scans are incremental by mtime with watcher + cron backup.)

#### Scenario: Re-correr el mismo escaneo no produce cambios

- GIVEN a library was scanned with 1,000 indexed files
- CUANDO "Scan" runs again with no modifications
- ENTONCES zero rows are inserted or updated

#### Scenario: Un archivo modificado se re-procesa

- GIVEN a file has `modified_at = T0`
- CUANDO the file is edited and "Scan" runs
- ENTONCES the row is re-extracted and `indexed_at` updates

### Requirement: Acciones explícitas de re-escaneo total y eliminación de faltantes

The system MUST expose "Re-scan all" (full rebuild) and "Remove missing files" actions. Files no longer on disk MUST NOT be auto-purged; they require explicit "Remove missing".

(Previously: identical action set. NAS now exposes `POST /api/admin/scan/full` and a missing-files reconcile job.)

#### Scenario: Re-escanear todo re-procesa cada archivo

- GIVEN a library with 1,000 indexed files
- CUANDO "Re-scan all" runs
- ENTONCES every file is re-extracted
- Y cached OL data is NOT re-fetched unless "Force refresh OL" is set

#### Scenario: Eliminar faltantes purga los archivos ausentes

- GIVEN 100 indexed files, 5 missing on disk
- CUANDO "Remove missing files" runs
- ENTONCES the 5 missing rows are deleted

### Requirement: Cancelación cooperativa

The system MUST support cooperative cancellation: Cancel finishes the current file then stops; MUST NOT abort mid-file.

(Previously: identical. BullMQ workers on NAS also honour per-job cancellation tokens.)

#### Scenario: Cancelar permite que el archivo en curso termine

- GIVEN a scan is mid-extraction of `book-042.pdf`
- CUANDO the user clicks Cancel
- ENTONCES `book-042.pdf` finishes
- Y the scanner stops before `book-043.pdf`

### Requirement: Modo WAL para lectura/escritura concurrentes

Local DB MUST be opened with SQLite WAL mode, autocommit, `synchronous=NORMAL`. Scan (writer) and UI search/browse (readers) MUST operate simultaneously without blocking.

(Previously: SQLite WAL. v2 keeps WAL locally and replaces NAS-side concurrency with Postgres MVCC.)

#### Scenario: La búsqueda sigue funcionando durante un escaneo

- GIVEN a scan is running
- CUANDO the user types a query
- ENTONCES FTS5 returns results in under 100 ms p95

### Requirement: Escaneo en background con UX de progreso

Scans MUST run as background tasks and report progress via SSE. The UI MUST show a progress indicator with counters (`seen`, `inserted`, `errors`, `skipped`), current file path, Cancel button, and recent errors.

(Previously: FastAPI + SSE locally. v2 keeps SSE for local scans and adds `GET /api/admin/scan/status` for NAS.)

#### Scenario: El indicador de progreso se actualiza

- GIVEN a scan is running
- CUANDO the scanner yields `ScanProgress`
- ENTONCES the sidebar pill increments `seen`
- Y the detail modal updates counters and current file

#### Scenario: El escaneo en background no congela la UI

- GIVEN a scan is in progress
- CUANDO the user clicks a library or runs a search
- ENTONCES the UI responds within 100 ms

## ADDED Requirements

### Requirement: Local scan and NAS scan are separate concerns

Local scans write to `local-library-db`; NAS scans write to `nas-catalog-service`. They MUST NOT share a single SQL store.

#### Scenario: Local and NAS stores remain distinct

- GIVEN a local scan on `~/Books/` and a NAS scan on `/share/biblioteca/raw/`
- CUANDO both finish
- ENTONCES `local-library-db.books` has only the local books
- AND `nas-catalog-service.books` has only the NAS books

#### Scenario: A book can be present locally AND on the NAS

- GIVEN `Ficciones.epub` is scanned locally AND exists on the NAS
- CUANDO both scans complete
- ENTONCES the local row has `source = 'local_scan'`
- AND the NAS row is independent

## Cross-references

- Depends on: `library-registry`, `metadata-extraction`, `thumbnail-generation`, `openlibrary-enrichment`
- New dep: `python-sidecar-cli`, `nas-scanner-workers`