# biblioteca-v2

Monorepo de la próxima iteración del proyecto de biblioteca personal
`alejandria`. Vive junto al MVP heredado en `../biblioteca/` y lo
reemplaza de forma incremental — el MVP permanece como
implementación de referencia.

## Estructura

```
biblioteca-v2/
├── services/
│   ├── extractors-py/   PR1 — CLI del sidecar Python
│   └── nas-backend/     PR2 — NestJS + Postgres + Redis + workers
├── apps/
│   ├── web/             PR3 — App Router de Next.js 16 + React 19
│   └── mac/             PR4 — Shell de Electron que envuelve apps/web
└── packages/
    ├── core/types/      Tipos TS compartidos que reflejan alejandria/core/models.py
    └── sidecar/         Spawn + sanitización de paths compartidos (PR-3-fix-B)
```

## Estado de los PR

| PR | Slice | Estado |
|----|-------|--------|
| PR1 | Sidecar Python (`services/extractors-py/`) | Merged |
| PR2 | Backend NestJS del NAS (`services/nas-backend/`) | Merged |
| PR-3A | Scaffold Next.js 16 + catálogo RSC browse (`apps/web/`) | Merged |
| PR-3B | SQLite local real + FTS5 + pipeline de escaneo + lector PDF (`apps/web/`) | Merged |
| PR-3C | Cliente NAS + descarga con Range + server actions + pdfjs (`apps/web/`) | **Este PR** |
| PR4 | Shell de Electron + iCloud Drive + ISBN pipeline de 7 capas | Pendiente |

## Ejecutar `apps/web/` (PR-3C)

La app web es el shell de Next.js 16 + React 19. Sirve el catálogo
de la biblioteca local en `/`, el shell de navegación del NAS en
`/browse`, el lector en `/reader/[bookId]`, y un CTA "Pair with
NAS" en la página principal. Las rutas de catálogo y navegación
del NAS son React Server Components con la directiva `'use cache'`
requerida por la spec `nextjs-app-shell`; el lector es un Client
Component para que `pdfjs-dist` pueda lazy-load en el navegador.

```bash
cd apps/web
npm install
npm run dev    # http://localhost:3001
```

### Scripts

| Script | Qué hace |
|--------|----------|
| `npm run dev` | Inicia el servidor de desarrollo de Next.js en el **puerto 3001** (el backend del NAS reserva `:3000`). |
| `npm run build` | Build de producción vía Turbopack. Salida en `.next/`. |
| `npm start` | Ejecuta el build de producción en el puerto 3001. |
| `npm test` | Ejecución única de Vitest (tests de componentes + lib bajo `**/__tests__/`). |
| `npm run test:watch` | Vitest en modo watch. |
| `npm run typecheck` | `tsc --noEmit` con el tsconfig estricto. |
| `npm run lint` | `next lint` vía `eslint-config-next`. |

### Rutas

| Path | Componente | Notas |
|------|------------|-------|
| `/` | `app/(catalog)/page.tsx` | RSC. Lee `lib/db/local-db.ts`. Cacheado por 1h con `cacheTag('local-library')`. Renderiza un formulario "Pair with NAS" (PR-3C) para que el usuario pueda obtener un bearer token. |
| `/browse` | `app/(nas)/browse/page.tsx` | RSC. Lee `lib/api/nas-client.ts` vía `GET /api/books`. Cacheado por 1h con `cacheTag('nas-catalog')`. Renderiza una lista vacía cuando el NAS está offline. |
| `/reader/[bookId]` | `app/reader/[bookId]/page.tsx` | Client Component. Monta `<Reader />` con `<ProgressBar />` y un `<PdfViewer />` lazy-loaded (`pdfjs-dist` vía `next/dynamic({ ssr:false })`). |
| `/livez` | `app/livez/route.ts` | Sonda de liveness. Siempre retorna 200 cuando el worker de Next.js está activo. Por convención de Kubernetes NO toca la base de datos. |
| `/readyz` | `app/readyz/route.ts` | Sonda de readiness. Ejecuta `PRAGMA quick_check` sobre el SQLite local. Retorna 200 cuando está sano, 503 con `{checks: {sqlite: '<error>'}}` cuando el DB está corrupto o ilegible. |

### Cliente NAS (PR-3C)

`lib/api/nas-client.ts` incluye un cliente HTTP `fetch` con
inyección de dependencias que implementa la superficie completa de
PR-2. Cada método devuelve una respuesta fuertemente tipada; los
callers nunca tocan `fetch` directamente.

| Método | Endpoint | Auth |
|--------|----------|------|
| `pair({ pin, deviceName })` | `POST /api/auth/pair` | Público |
| `refresh()` | `POST /api/auth/refresh` | Público (envía token actual) |
| `listBooks({ page, limit, authorId, format, language })` | `GET /api/books` | Bearer |
| `getBook(id)` | `GET /api/books/:id` | Bearer |
| `search(q, { limit, offset })` | `GET /api/search` | Bearer |
| `listCategories()` | `GET /api/categories` | Bearer |
| `getDiscoveryInfo()` | `GET /api/discovery/info` | Público |
| `getDiscoveryNetwork()` | `GET /api/discovery/network` | Bearer |
| `startDownload({ bookId, deviceId, deviceName, userId, fileSizeBytes })` | `POST /api/downloads` | Bearer |
| `completeDownload(id, { completed, bytesTransferred })` | `PATCH /api/downloads/:id` | Bearer |
| `downloadFile(bookId, destPath, onProgress, options?)` | `GET /api/files/:id` (Range) | Bearer |

Construcción:

```ts
import { createNasClient } from '@/lib/api/nas-client'

const client = createNasClient({
  baseUrl: process.env.ALEJANDRIA_NAS_URL, // opcional, default http://localhost:3000
  token: '<jwt>',                          // opcional, setear tras pair/refresh
  fetch: globalThis.fetch,                 // opcional, default fetch global
})
```

### Flujo de descarga (PR-3C)

`lib/download/download-flow.ts` orquesta el lado NAS de una
descarga de libro:

1. `INasClient.getBook` — resuelve los metadatos
2. `INasClient.startDownload` — abre la fila de tracking
3. `INasClient.downloadFile` — streamea los bytes con `Range: bytes=0-`
4. `openLocalDb().insertBook` — persiste la fila para que el lector la encuentre
5. `INasClient.completeDownload` — cierra la fila de tracking

```ts
import { createNasClient } from '@/lib/api/nas-client'
import { downloadBook } from '@/lib/download/download-flow'

const client = createNasClient({ token: '<jwt>' })
const result = await downloadBook({
  bookId: 7,
  deviceId: 'web-uuid',
  deviceName: 'web-MacBook Pro',
  userId: 'self',
  destPath: '/path/to/ficciones.pdf',
  nasClient: client,
})
```

El transporte Range resumible vive en
`lib/download/range-client.ts` (`downloadWithRange(url, destPath,
fetchImpl, options)`). Acepta 200 OK (sin soporte Range) y 206
Partial Content, dispara un callback `onProgress` por chunk, y
retorna el total de bytes escritos.

### Server Actions (PR-3C)

`app/_actions/nas-actions.ts` expone Server Actions delgadas que
las páginas RSC llaman desde `<form action={…}>`:

| Action | Qué hace |
|--------|----------|
| `pairDevice(formData)` | Lee `pin` + `deviceName`; retorna `Result<NasPairResponse, ErrorMessage>`. |
| `refreshToken(formData)` | Lee `token`; retorna `Result<NasPairResponse, ErrorMessage>`. |
| `downloadFromNas(formData)` | Lee `bookId` + atribución del dispositivo; ejecuta `downloadBook`; retorna `Result<DownloadBookResult, ErrorMessage>`. |
| `scanLocalFolder(formData)` | Lee `filePath`; ejecuta `scanFile`; retorna `Result<BookRow, ErrorMessage>`. |

Las cuatro retornan una unión discriminada para que la página
renderice errores sin ruido de try/catch.

### Visor PDF (PR-3C)

`components/PdfViewer.tsx` hace lazy-load de `pdfjs-dist`,
configura el worker vía `URL(new URL(..., import.meta.url))`, y
renderiza la página actual en un `<canvas>`. El componente expone:

- `currentPage` — número de página controlado
- `onPageChange(page)` — disparado por los botones prev/next
- `onError(error)` — disparado en rechazo de render para que el
  padre pueda mostrar UI de fallback

El Reader conecta `onPageChange` al estado local `currentPage` y a
la capa de persistencia de la ruta.

### SQLite Local

`lib/db/local-db.ts` abre una única base de datos SQLite en
`<ALEJANDRIA_DATA_DIR>/library.sqlite` (default
`apps/web/data/library.sqlite`). El archivo se crea con el schema
completo en la primera apertura — `books`, `authors`, `categories`,
`book_categories`, `sagas`, `book_sagas`, `reading_progress`, más
una tabla virtual FTS5 (`books_fts`) sincronizada por triggers
sobre `books.title` + `books.excerpt`. `data/library.sqlite` está
en `.gitignore`.

| Helper | Qué hace |
|--------|----------|
| `openLocalDb()` | Abre (o crea) la DB y retorna el objeto helper. Ejecuta `PRAGMA integrity_check` en la primera apertura del proceso; las aperturas siguientes omiten el check (es O(tamaño-archivo)). |
| `db.insertBook(input)` | Inserta un libro. Lanza en `id` / `content_hash` duplicados. |
| `db.findById(id)` | Obtiene un libro por id, o `null` si no existe. |
| `db.listBooks()` | Lista todos los libros en orden `rowid` DESC (más recientes primero). |
| `db.searchBooks(query)` | Búsqueda FTS5 prefix-match sobre `title` + `excerpt`. |
| `db.insertProgress(bookId, page, pct)` | Upsert del progreso de lectura. |
| `db.getProgress(bookId)` | Obtiene el progreso de lectura, o `null` si no existe. |

#### Recuperación por corrupción de `library.sqlite`

Si `openLocalDb` lanza con un mensaje como `integrity_check
failed for …/library.sqlite`, el archivo está corrupto. Para
recuperar:

1. Cerrá cualquier proceso que tenga el write lock de SQLite (la
   app web, cualquier terminal de `<alejandria>` abierto, el main
   process de Electron).
2. **Respaldá el archivo corrupto** (movelo a un path hermano para
   poder inspeccionarlo después si hace falta):
   ```bash
   mv apps/web/data/library.sqlite apps/web/data/library.sqlite.corrupt
   ```
3. Borrá los archivos WAL/SHM residuales para que SQLite no intente
   reproducir el journal corrupto:
   ```bash
   rm -f apps/web/data/library.sqlite-wal apps/web/data/library.sqlite-shm
   ```
4. Dispará un escaneo nuevo — ya sea vía la Server Action
   `scanLocalFolder` en `/` o re-ejecutando la CLI del sidecar PR1:
   ```bash
   python -m alejandria_sidecar extract /path/to/library
   ```
   El nuevo `library.sqlite` se crea con el schema completo en la
   primera `openLocalDb`. Cualquier libro que vuelvas a agregar
   obtiene un `content_hash` nuevo (el lado NAS conserva los
   originales).

Si la corrupción se repite en cada apertura nueva, el disco
subyacente probablemente esté fallando — respaldá
`data/library.sqlite` y la tabla `books` del NAS, y reemplazá el
almacenamiento.

### Pipeline de escaneo

`lib/scan/local-pipeline.ts` expone `scanFile(path, { spawn })` que
ejecuta `python -m alejandria_sidecar extract <path>` (el sidecar
de PR1), parsea el envelope JSON versionado, e inserta los
metadatos resultantes en el SQLite local. El paso de spawn se
inyecta vía `SidecarSpawnFn` para que el pipeline sea
unit-testeable sin Python.

### Variables de entorno

| Var | Default | Usada por |
|-----|---------|-----------|
| `ALEJANDRIA_DATA_DIR` | `<cwd>/data` | `lib/db/local-db.ts` — ubicación del único archivo `library.sqlite`. |
| `ALEJANDRIA_NAS_URL` | `http://localhost:3000` | `lib/api/nas-client.ts` — URL base del backend NAS. |

### Qué está stub en PR-3C

- La página de browse NAS renderiza una lista vacía cuando el
  backend es inalcanzable (modo offline dev). El `try/catch` es
  intencional para que la ruta no rompa el build.
- El formulario "Pair with NAS" muestra el device id en éxito pero
  aún no persiste el JWT en una cookie. PR-3E cablea `cookies()` +
  redirect.
- La acción `downloadFromNas` escribe el archivo en
  `<cwd>/data/books/<id>.bin`. El path destino se moverá a
  `app.getPath('userData')` cuando llegue el shell de Electron.
- El campo `author` en las filas NAS persistidas localmente es un
  placeholder (`author:<id>`) porque el payload de detalle del NAS
  solo expone `author_id`. Un PR siguiente joinea contra
  `/api/authors/:id` para obtener el nombre a mostrar.

### Detalles del stack

- Next.js **16.2** con `cacheComponents: true` (Partial
  Prerendering + directiva `'use cache'`).
- React **19.2** con Strict Mode.
- TypeScript **5.5** en modo estricto (`noUncheckedIndexedAccess`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch`).
- Vitest **2.1** + Testing Library **16** + jsdom para tests de
  componentes. `vitest.config.ts` mapea el alias `@/*` a la raíz
  del proyecto para que los tests puedan importar los mismos paths
  que la fuente.
- ESLint vía `eslint-config-next`.

## Observabilidad (PR-3-fix-C, #61)

La aplicación web incluye un logger estructurado pequeño,
propagación de request-ID y dos endpoints de health.
Juntos permiten que un depurador rastree una sola acción
del usuario desde el navegador a través de la Server
Action, la escritura en DB y la llamada al NAS.

### Logger estructurado (`lib/log.ts`)

```ts
import { info, warn, logError } from '@/lib/log'

info('scan', 'file queued', { filePath, sizeBytes })
warn('nas-client', 'slow response', { latencyMs: 1500 })
logError('scan', err, { filePath, stage: 'envelope-parse' })
```

Cada llamada emite un único registro JSON al sink
correspondiente de `console.*` (`log` para info, `warn`
para warn, `error` para error):

```json
{
  "timestamp": "2026-06-29T12:34:56.789Z",
  "level": "error",
  "scope": "scan",
  "message": "Unexpected token n in JSON at position 0",
  "requestId": "a1b2c3d4e5f6g7h8",
  "context": { "filePath": "/library/rayuela.epub", "stage": "envelope-parse" },
  "error": { "name": "SyntaxError", "message": "...", "stack": "..." }
}
```

En dev / test (`NODE_ENV !== 'production'`) el logger emite
una línea human-readable en lugar de JSON. El writer
también es inyectable vía `setWriter` para que los tests
puedan capturar registros sin monkey-patching de
`console`.

### Propagación de request-ID (`lib/middleware/request-id.ts` + `proxy.ts`)

Cada request pasa por el middleware raíz `proxy.ts`
(Next.js 16 lo renombró desde `middleware.ts`). El
middleware:

1. Lee el header entrante `X-Request-Id` (o genera un id
   fresco de 16 caracteres hex vía `crypto.randomUUID()`
   cuando está ausente).
2. Llama a `lib/log.setRequestId(id)` para que cada llamada
   posterior a `info`/`warn`/`logError` durante la vida
   del request lleve el id.
3. Setea `X-Request-Id` en la respuesta saliente para que
   el cliente pueda correlacionar end-to-end.
4. Llama a `lib/log.clearRequestId()` después de la
   respuesta para que el id nunca se filtre al siguiente
   request en el mismo worker.

### Observabilidad en bloques catch

Cada bloque catch en los módulos bajo test llama a
`logError(scope, err, { context })` antes de re-tirar o
retornar un error estructurado:

| Módulo | Scope | Context |
|--------|-------|---------|
| `lib/scan/local-pipeline.ts` | `scan` | `{stage, filePath}` |
| `lib/api/nas-client.ts` | `nas-client` | `{stage, status\|destPath, path}` |
| `app/_actions/nas-actions.ts` (pair) | `nas-actions.pairDevice` | `{pinLength, code}` |
| `app/_actions/nas-actions.ts` (refresh) | `nas-actions.refreshToken` | `{hasToken, code}` |
| `app/_actions/nas-actions.ts` (download) | `nas-actions.downloadFromNas` | `{bookId, code}` |
| `app/_actions/nas-actions.ts` (scan) | `nas-actions.scanLocalFolder` | `{filePath}` |
| `app/readyz/route.ts` | `readyz` | `{check, stage?}` |

`lib/download/download-flow.ts`, `BookDownloadForm`, y
`PairWithNasForm` no tienen bloques `try/catch` —
propagan a la Server Action, que es el único boundary
donde se enforza la observabilidad.

### `/livez` (liveness)

```
GET /livez → 200 {status: 'ok'}
```

Una falla de liveness significa que el orquestador de
contenedores debe reiniciar este proceso. Por convención
de Kubernetes / RFC este endpoint NO debe depender de
servicios externos (el SQLite local vive en
`lib/db/local-db.ts`) — una falla de liveness no debe
disparar un reinicio por una caída transitoria del DB.

### `/readyz` (readiness)

```
GET /readyz → 200 {status: 'ok',    checks: {sqlite: 'ok'}}
GET /readyz → 503 {status: 'degraded', checks: {sqlite: '<error>'}}
```

Una falla de readiness significa que el load balancer debe
dejar de mandar tráfico a esta instancia; el proceso en sí
está bien. El handler abre el SQLite local, ejecuta
`PRAGMA quick_check` (variante barata O(pages) de
`integrity_check`), y cierra el handle en un `finally`
para no leakearlo. Una falla se logea vía `logError` con
`scope='readyz'` para que el operador vea el contexto
completo en el stream estructurado de logs.

## Ver también

- [Racional de diseño](openspec/changes/alejandria-v2/design.md)
- Spec — nextjs-app-shell
- Spec — library-browse-ui
- Spec — nas-browse-download
- Spec — local-library-db
- Spec — book-reader
- Spec — pdf-reader
- Spec — epub-reader
- Spec — python-sidecar-cli