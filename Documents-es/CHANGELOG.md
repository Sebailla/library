# Changelog

Todos los cambios notables de **alejandria-v2** se documentan aquí. El formato sigue [Keep a Changelog](https://keepachangelog.com/) y este proyecto se adhiere a [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- **monorepo + web + nas-backend (PR-3-fix-B)**: se extrajo el hardening del sidecar de PR-2E a un paquete workspace compartido `@alejandria/sidecar` (`sanitizePath`, `spawnSidecar`, `SPAWN_TIMEOUT_MS = 60s`, `MAX_OUTPUT_BYTES = 64 MiB`). Tanto `apps/web/lib/scan/local-pipeline.ts` como `services/nas-backend/src/workers/scan.processor.ts` consumen ahora los mismos helpers, de modo que el lado web ya no reabre los modos de falla de inyección de argv / stdout sin tope / intérprete Python colgado (issue #60, BLOCKER).
- **web (PR-3-fix-B)**: `download-flow` envuelve cada paso del round-trip al NAS (`getBook`, `startDownload`, `downloadFile`, `completeDownload`) en un nuevo helper `withRetry({ attempts: 3, backoff: 'exp', baseMs: 250 })`, de modo que un único 503/504/caída de red ya no deja una fila de tracking abierta en el NAS. Además cablea soporte de resume vía `downloadBook({ start: bytesAlreadyOnDisk })` (issue #62, CRITICAL).
- **web (PR-3-fix-B)**: `nas-client.downloadFile` ahora streamea los chunks directo a disco (una llamada a `writeFile` por chunk de red) y aplica `MAX_DOWNLOAD_BYTES = 1 GiB`. En overflow, el helper rechaza con `DownloadOverflowError(code='DOWNLOAD_OVERFLOW')` y borra el archivo destino parcial para que un retry fallido no deje bytes stale (issue #63, CRITICAL).
- **web (PR-3-fix-B)**: `loadCatalog` (catálogo) y `loadReader` (lector) envuelven sus lecturas SQLite en try/catch — un lock contention o corrupción de SQLite ya no devuelve 500 en las rutas. El catálogo renderiza el CTA de estado vacío; el lector renderiza un fallback amigable apuntando al procedimiento de recuperación (issue #64, CRITICAL).
- **web (PR-3-fix-B)**: `openLocalDb` ejecuta `PRAGMA integrity_check` en la primera apertura del proceso. Un `library.sqlite` corrupto ahora lanza un error claro de forma temprana en lugar de fallar cada lectura downstream. El check se indexa por path absoluto para que un suite de tests que cambia `ALEJANDRIA_DATA_DIR` por test siga viendo un check fresco (issue #64, CRITICAL).

### Changed
- **web (PR-3-fix-A)**: la ruta del lector en `/reader/[bookId]` ahora monta el PDF real. La página antes llamaba `<Reader book={...} />` sin reenviar `book.filePath`, por lo que la rama `PdfSurface` gateada por `filePath` en `<Reader />` (Reader.tsx:88) era código muerto en producción (issue #59, BLOCKER).
- **web (PR-3-fix-A)**: `download-flow` reporta los bytes reales recibidos desde el callback `onProgress` de `nas-client.downloadFile` como `bytesTransferred` al NAS — no el tamaño esperado del pre-flight `book.file_size_bytes`, que diverge en transfers parciales / resumidos / fallidos (issue #65, CRITICAL).
- **web (PR-3-fix-A)**: se consolidaron dos tipos `BookRow` en conflicto. El row canónico de 8 campos vive en `@/lib/db/local-db`; el tipo del lado componentes de 4 campos ahora es `BookListItem` en `@/components/BookList`. El shim interno `BookRowDb` se eliminó (issue #66, BLOCKER).

### Planned
- PR3: shell de Next.js 16 (browse + search + reader)
- PR4: shell de Electron + sync iCloud Drive + ISBN pipeline de 7 capas

---

## [0.2.0] — 2026-06-28 — Backend NestJS con fixes de la review 4R

Segunda release del refactor `alejandria-v2`. Agrega el backend NestJS completo que vive en el QNAP NAS, más todos los fixes del fan-out de la review 4R (R1 Risk, R2 Readability, R3 Reliability, R4 Resilience).

### Added

- Scaffold de backend NestJS 10 con endpoint de health
- Schema Postgres 16 + pgroonga cubriendo books, authors, categorías bilingües (es + en), book_categories, sagas, downloads, devices
- 10 migraciones SQL idempotentes con bookkeeping `schema_migrations`
- Módulo de auth: pairing por PIN + emisión de JWT + hashing de tokens con SHA-256
- Módulos HTTP Books/Authors/Search con búsqueda full-text respaldada por pgroonga
- Módulo HTTP Downloads con chequeos de ownership por device
- Workers: BullMQ + Redis + spawn Python del sidecar con sanitización de path, tope stdout 64 MB, timeout 60 s, cap de intentos, backoff exponencial
- Discovery: mDNS (con error listener de bonjour) + probe de IP Tailscale + endpoint dividido (pre-auth `/api/discovery/info`, auth-required `/api/discovery/network`)
- Rate limiting con `@nestjs/throttler` en endpoints de auth y discovery
- `ValidationPipe` global que retorna el envelope estándar `{error: {code, message}}` del proyecto
- Migración pg_cron nightly de `pgroonga_index_defrag` (con overlay Dockerfile.pg para operadores en el QNAP)
- 165 tests pasando a través de capas unit y e2e

### Security

- **BREAKING (production)**: se removieron los defaults hardcoded de JWT secret y PIN; production falla al iniciar si `NAS_JWT_SECRET` (≥32 bytes) o `NAS_PAIR_PIN` (≥8 chars) no están seteados
- **BREAKING (production)**: se removió el default hardcoded de `DATABASE_URL`
- Sanitización de paths en `scan.processor.ts` antes del spawn: rechaza segmentos `..`, paths que comienzan con `-`, y paths fuera de `NAS_LIBRARY_ROOT`
- Rate limiting: 5/min en `/api/auth/pair`, 10/min en `/api/auth/refresh`, 60/min en `/api/discovery/info`
- Split del endpoint discovery: la respuesta pre-auth ya no filtra `tailscale_ip` ni `lan_ips`
- Fixes IDOR en `/api/downloads`: campos de device derivados del bearer, no del body; PATCH y GET cross-device devuelven 403
- bcrypt reemplazado con SHA-256 para hashing de tokens (bcrypt silenciosamente trunca inputs >72 bytes, lo que rompía la rotación de refresh tokens)

### Changed

- `/health` se dividió en `/livez` (siempre 200 si el proceso está arriba) y `/readyz` (503 solo cuando Postgres no es alcanzable; Redis caido sigue siendo 200)
- Las migraciones pg son transaccionales e idempotentes vía la tabla `schema_migrations`; el runner skipea archivos ya aplicados
- `HealthModule` ya no define su propio `pg.Pool` paralelo; importa el pool de `DatabaseModule`
- La idempotencia de Downloads usa enforcement del lado DB (no solo chequeos del lado servicio)

### Fixed

- Los workers BullMQ no tenían cap de retries; un archivo corrupto bloqueaba la queue por siempre. Ahora: `attempts: 3`, backoff exponencial, `removeOnComplete`/`removeOnFail`, `SidecarError` → `UnrecoverableError`
- El bind failure de mDNS bonjour crasheaba el proceso Node vía `EventEmitter` error sin manejar; ahora: listener `on('error', ...)` adjunto
- El endpoint search aceptaba `q` length sin tope (vector DoS vía pgroonga); ahora: `@MaxLength(256)` + whitelist regex
- El default de `tsvector` weights en pgroonga se balanceó para evitar el ranking "todo-A" en queries cortas
- El build de TypeScript en CI fallaba en `experimentalDecorators` faltante; ahora está activo en tsconfig build
- Las migraciones no registraban `applied_at` cuando se aplicaban dentro de la misma transacción; ahora se commitea antes de la migración
- El módulo throttler rechazaba el header `User-Agent` ausente con 500; ahora devuelve 429 con un envelope de error estructurado
- `pairDevice` aceptaba un PIN de 1 dígito y devolvía 200; ahora validación `@MinLength(4)` enforced antes del lookup
- El módulo discovery filtraba `lan_ips` en respuesta pública; ahora se mueve a `/api/discovery/network` que requiere auth
- El `me` endpoint no incluía el `device_name`; ahora se proyecta desde la join con `devices`
- El health endpoint duplicaba la conexión Postgres (memory leak bajo carga); ahora comparte el pool
- El `bonjour` advertise corría en modo blocking y colgaba el event loop; ahora se inicializa async con timeout