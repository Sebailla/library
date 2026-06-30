# Manual de usuario — alejandria-v2

> **Versión actual**: v0.5.1 (2026-06-30)
>
> Este manual explica cómo usar la aplicación completa: el lado del servidor NAS, la app web, y la app de escritorio para macOS. Está pensado para vos como usuario final, no para quien opera el código.

---

## Tabla de contenidos

1. [¿Qué es alejandria-v2?](#1-qué-es-alejandria-v2)
2. [Arquitectura general](#2-arquitectura-general)
3. [Setup inicial](#3-setup-inicial)
4. [Uso diario](#4-uso-diario)
5. [Servidor NAS en producción](#5-servidor-nas-en-producción)
6. [Operaciones comunes](#6-operaciones-comunes)
7. [Troubleshooting](#7-troubleshooting)
8. [Referencia de endpoints](#8-referencia-de-endpoints)

---

## 1. ¿Qué es alejandria-v2?

**alejandria-v2** es un sistema de gestión de biblioteca personal. Vos metés tus libros digitales (PDF, EPUB, MOBI, etc.) en una carpeta del NAS, y la app los indexa, los organiza y te permite leerlos desde el Mac, el iPad, o el navegador.

Está pensado para bibliotecas **personales grandes** (decenas a cientos de miles de libros), no para colecciones chicas. El caso de uso es: "tengo una colección que se va a quedar conmigo toda la vida, quiero que esté siempre accesible, indexada, con anotaciones sincronizadas entre dispositivos, y sin depender de un servicio cloud de terceros".

### Qué lo diferencia de alternativas comerciales

| Característica | alejandria-v2 | Kindle/Apple Books |
|----------------|---------------|--------------------|
| Formatos aceptados | PDF, EPUB, MOBI, AZW3, DJVU, CBZ, audio, video | solo EPUB/MOBI (Kindle), solo EPUB/PDF (Apple) |
| Dónde vive tu biblioteca | tu propio NAS (QNAP o similar) | sus servidores |
| Anotaciones sincronizan entre dispositivos | sí, via iCloud (modelo Apple Books) | sí, pero a sus servidores |
| Reconoce ISBN automáticamente | sí, con 7 capas de fallback (metadata embebida → regex → OpenLibrary → Google Books → Vision OCR → Unlimited-OCR → bibliotecas nacionales) | sí, con un solo proveedor |
| Organiza archivos automáticamente por autor/título | sí, con dry-run antes de mover nada | sí, automático sin preview |
| Multi-biblioteca | sí, podés tener varias (ej: "Libros", "Papers", "Comics") | no |
| Funciona offline | sí, todo el procesamiento es local + tu NAS | depende de conexión |
| Tamaño máximo de biblioteca | sin límite práctico (testeado con 2M) | limitado por el plan |

### Stack técnico (resumen)

- **Sidecar Python** (v0.1.0): extrae metadata de los archivos (título, autor, ISBN, año, etc.) usando los 12 extractores + OCR con Apple Vision.
- **Backend NestJS** (v0.5.1): corre en tu QNAP, expone la API REST, persiste todo en Postgres + pgroonga para búsqueda full-text.
- **App web Next.js 16** (v0.3.0): el navegador, RSC, sirve el catálogo, la búsqueda, el lector de PDFs.
- **App macOS Electron 33** (v0.4.0): el wrapper de macOS que combina la app web con el sidecar Python, sincroniza con iCloud, y maneja la integración con el sistema operativo.

---

## 2. Arquitectura general

```
┌─────────────────────────────────────────────────────────────┐
│ Tu Mac (o iPad via navegador)                              │
│                                                             │
│  ┌────────────────────────────────────────┐                │
│  │ Electron 33 shell (apps/mac)            │                │
│  │  ┌──────────────────────────────────┐   │                │
│  │  │ Next.js 16 web app (apps/web)   │   │                │
│  │  │  (localhost:3001 dev)          │   │                │
│  │  └──────────────┬───────────────────┘   │                │
│  │  ┌──────────────┴───────────────────┐   │                │
│  │  │ sidecar Python (services/...py)│   │                │
│  │  │  extrae metadata de archivos    │   │                │
│  │  └──────────────┬───────────────────┘   │                │
│  │  ┌──────────────┴───────────────────┐   │                │
│  │  │ iCloud Drive sync (modelo       │   │                │
│  │  │ Apple Books, chokidar watcher)  │   │                │
│  │  └──────────────────────────────────┘   │                │
│  └─────────────────┬────────────────────┘                │
│                    │ HTTP                                  │
│                    ▼                                       │
└────────────────────┼───────────────────────────────────────┘
                     │
                     │  Tailscale (LAN o VPN) o LAN directo
                     │
┌────────────────────┼───────────────────────────────────────┐
│ Tu QNAP (u otro NAS Linux)                                │
│                    │                                       │
│  ┌─────────────────┴────────────────────┐                │
│  │ NestJS 10 (services/nas-backend)     │                │
│  │  :3000 HTTP                          │                │
│  │  ┌────────────────────────────────┐  │                │
│  │  │ Postgres 16 + pgroonga          │  │                │
│  │  │  - books, authors, categories   │  │                │
│  │  │  - downloads, devices, scan_jobs│  │                │
│  │  │  - organize_plans, libraries    │  │                │
│  │  └────────────────────────────────┘  │                │
│  │  ┌────────────────────────────────┐  │                │
│  │  │ Redis 7 (BullMQ queues)         │  │                │
│  │  └────────────────────────────────┘  │                │
│  │  ┌────────────────────────────────┐  │                │
│  │  │ /share/biblioteca/raw/          │  │                │
│  │  │  filesystem con tus libros       │  │                │
│  │  └────────────────────────────────┘  │                │
│  └─────────────────────────────────────┘                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Lo que pasa cuando abrís un libro**:

1. Abrís la app de Mac (o el navegador en el iPad).
2. La app hace una request HTTP a `http://<tu-qnap>:3000/api/books/...` (si es el primer uso, te pide el PIN para pairar).
3. El backend NestJS consulta Postgres por el libro, devuelve metadata + URL firmada para descargar.
4. La app descarga el PDF con HTTP Range (puede pausar y resumir), lo guarda en una carpeta local (`~/Library/Application Support/Alejandria/books/`).
5. Cuando abrís el PDF, el lector (basado en pdfjs-dist) lo renderiza página por página.
6. Si subrayás algo o tomás notas, se guardan en formato Apple Books (un JSON por libro) en `~/Library/Mobile Documents/com~apple~cloudDocs/Alejandria/`. iCloud Drive los sincroniza al iPad automáticamente.

---

## 3. Setup inicial

### 3.1 Requisitos

| Componente | Requisitos |
|------------|------------|
| NAS | QNAP con Container Station (Docker) o cualquier Linux con Docker 24+. Mínimo 16 GB de RAM (recomendado 32 GB para 2M de libros). |
| Mac | macOS 12+ (Apple Silicon o Intel). 8 GB de RAM mínimo. |
| iPad/iPhone | iOS 16+ con Safari. Para mejor experiencia, usar la app de Mac como principal. |
| Red | LAN o Tailscale (recomendado). Tailscale te da acceso seguro al NAS desde cualquier lugar sin abrir puertos. |
| Python (solo para dev) | 3.11, 3.12, o 3.13 (NO 3.14 — pyobjc-Vision no tiene wheels para esa versión). |
| Node | 20.x LTS. |
| Git | para clonar el repo. |
| Docker | 24+ con docker compose. |
| Apple Developer account | solo si querés firmar y notarizar la app de Mac para distribución. |

### 3.2 Setup del servidor NAS

**1. Clonar el repositorio**:

```bash
git clone git@github.com:Sebailla/library.git
cd library/services/nas-backend
```

**2. Configurar las variables de entorno**:

Copiá el archivo de ejemplo y editá los valores. **No commitees este archivo al repo**.

```bash
cp .env.example .env
nano .env
```

Las variables **obligatorias** (sin defaults, la app no arranca sin ellas en producción):

```bash
NAS_JWT_SECRET=<una-cadena-aleatoria-de-al-menos-32-bytes>
NAS_PAIR_PIN=<un-pin-de-al-menos-8-caracteres>
DATABASE_URL=postgresql://user:password@postgres:5432/alejandria
```

Para generar el JWT secret usá:

```bash
openssl rand -hex 32
```

Variables opcionales (con defaults):

```bash
NODE_ENV=production
PORT=3000
NAS_LIBRARY_ROOT=/share/biblioteca/raw
POSTGRES_USER=alejandria
POSTGRES_PASSWORD=  # usar una fuerte
REDIS_HOST=redis
REDIS_PORT=6379
NAS_PIN_TTL_DAYS=30
NAS_JWT_TTL_HOURS=24
```

**3. Levantar los servicios con Docker Compose**:

```bash
docker compose up -d
```

Esto levanta 3 servicios:

- `postgres` (Postgres 16 con la extensión `pgroonga` para búsqueda full-text).
- `redis` (Redis 7 para las colas de BullMQ).
- `nas-backend` (la app NestJS).

**4. Verificar que funciona**:

```bash
curl http://localhost:3000/livez
# → 200 {"status":"ok"}

curl http://localhost:3000/readyz
# → 200 {"status":"ok","checks":{"sqlite/postgres":"ok"}}
```

**5. Hacer el primer pair con un dispositivo**:

```bash
curl -X POST http://localhost:3000/api/auth/pair \
  -H "Content-Type: application/json" \
  -d '{"pin":"<tu-pin>","device_name":"Mi MacBook"}'
# → 201 {"token":"<jwt>","expires_at":"...","device_id":"..."}
```

Guardá el `token` y el `device_id`. Los vas a usar en la app.

### 3.3 Setup de la app de Mac

**1. Instalar Xcode Command Line Tools** (necesario para Electron y el sidecar Python):

```bash
xcode-select --install
```

**2. Instalar pyenv** (recomendado para tener Python 3.12 aislado):

```bash
brew install pyenv
pyenv install 3.12
pyenv global 3.12
```

**3. Clonar el repo (si no lo hiciste antes)**:

```bash
git clone git@github.com:Sebailla/library.git
cd library/apps/mac
```

**4. Instalar dependencias**:

```bash
npm install
```

**5. Iniciar la app en dev**:

```bash
npm start
```

La app abre una ventana con la UI. La primera vez te va a pedir el PIN de pair.

### 3.4 Setup de la app web (opcional, para usar desde el navegador)

Si querés usar alejandria desde el iPad o desde cualquier navegador sin instalar la app de Mac:

```bash
cd apps/web
npm install
npm run dev
```

Abrí `http://<ip-de-tu-mac>:3001` en el navegador. La app web no tiene todas las features de la app de Mac (no tiene sidecar local, no sincroniza con iCloud), pero sirve para browsear y leer.

### 3.5 Setup de iCloud Drive (solo macOS)

Para que las anotaciones se sincronicen entre Mac e iPad:

**1. Asegurate de que iCloud Drive esté activado** en Preferencias del Sistema → Apple ID → iCloud → iCloud Drive.

**2. Verificá que la carpeta de la app exista**:

```bash
ls ~/Library/Mobile\ Documents/com~apple~cloudDocs/Alejandria/
```

Si no existe, la app la crea automáticamente al primer sync.

**3. Si querés testear en un sistema no-Mac** (Linux, Windows), podés overridear la ubicación:

```bash
export ALEJANDRIA_ICLOUD_DIR=/tmp/alejandria-test
mkdir -p $ALEJANDRIA_ICLOUD_DIR
```

---

## 4. Uso diario

### 4.1 Pairing con el NAS

La primera vez que abrís la app de Mac, te aparece un formulario de "Pair with NAS":

- **NAS URL**: la URL de tu NAS, por ejemplo `http://192.168.1.50:3000` (LAN) o `http://100.x.x.x:3000` (Tailscale).
- **PIN**: el `NAS_PAIR_PIN` que configuraste en `.env`.
- **Device name**: un nombre para identificar este dispositivo (ej: "MacBook Pro Oficina").

Click en "Pair". La app obtiene un JWT que persiste para próximas sesiones.

Si te equivocás de PIN 5 veces en un minuto, la app se bloquea temporalmente (rate limiting). Esperá un minuto y probá de nuevo.

### 4.2 Escanear una carpeta

El backend tiene dos modos de escaneo:

- **Full scan**: reprocesa todos los archivos.
- **Incremental scan**: solo procesa archivos modificados desde el último scan (usa mtime).

Para iniciar un scan desde la app de Mac:

1. Abrí la app, andá a Settings → Library → "Scan folder".
2. Seleccioná la carpeta del NAS donde están tus libros (`/share/biblioteca/raw/` por default).
3. Elegí el tipo (Full / Incremental) y click "Start scan".
4. La UI te muestra el progreso via SSE stream. Eventos `progress` (cada N archivos), `done`, `cancelled` o `failed`.

También podés disparar un scan via API:

```bash
# Full scan
curl -X POST http://localhost:3000/api/admin/scan/full \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"library_id": 1}'

# Incremental
curl -X POST http://localhost:3000/api/admin/scan/incremental \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"library_id": 1}'

# Ver estado
curl http://localhost:3000/api/admin/scan/status \
  -H "Authorization: Bearer <admin-token>"

# Cancelar
curl -X POST http://localhost:3000/api/admin/scan/cancel/<job_id> \
  -H "Authorization: Bearer <admin-token>"
```

Para usar estos endpoints necesitás un dispositivo con `is_admin = true`. Para promover un device a admin (solo una vez):

```sql
-- Conectate al Postgres del NAS
psql -h <nas-ip> -U alejandria -d alejandria
UPDATE devices SET is_admin = TRUE WHERE device_id = '<tu-device-id>';
```

### 4.3 Buscar libros

**Desde la app**:

El campo de búsqueda arriba de la lista de libros busca en:
- Título (FTS5, con tolerancia a typos)
- Excerpt (primeras 5000 chars del libro)
- Categorías (si las asignaste)
- Autor (placeholder actual: el backend no une el nombre todavía, ese es un follow-up)

**Desde la API**:

```bash
curl http://localhost:3000/api/search?q=borges+ficciones \
  -H "Authorization: Bearer <token>"
```

La búsqueda usa `pgroonga &@~` que es **mucho** más rápido que `LIKE %...%` y soporta CJK (chino, japonés, coreano) out-of-the-box.

### 4.4 Browsear el NAS

Desde la app de Mac, andá a "Browse NAS" en el sidebar. Vas a ver la lista de libros del NAS. Click en uno → download → read.

La descarga usa HTTP Range, así que:
- Si la conexión se cae a mitad de descarga, se reanuda automáticamente desde donde quedó.
- Si tenés poco ancho de banda, la app puede pausar y resumir.

### 4.5 Leer un PDF

La app abre el PDF con pdfjs-dist. Controles:

- `←` `→`: página anterior/siguiente
- `scroll`: scroll natural
- `cmd/Ctrl + F`: buscar texto dentro del PDF
- Click + drag: seleccionar texto
- Click derecho sobre texto seleccionado: menú contextual (copiar, subrayar, tomar nota)

El progreso de lectura (última página, porcentaje) se guarda automáticamente en la base de datos local. Si volvés a abrir el libro, la app te lleva a la última página.

### 4.6 Anotaciones (highlights, notas, bookmarks)

Seleccioná texto en el PDF → "Add highlight" o "Add note". La app guarda:

- **Highlight** (subrayado): color + texto seleccionado + posición en el PDF.
- **Note** (nota post-it): texto libre + posición (anclada a una página o a un highlight).
- **Bookmark** (marcador): solo posición en la página.

Las anotaciones se guardan en formato Apple Books:

```
~/Library/Mobile Documents/com~apple~cloudDocs/Alejandria/
├── notes/<bookId>.json
├── highlights/<bookId>.json
└── bookmarks/<bookId>.json
```

iCloud Drive sincroniza estos JSON entre tu Mac y tu iPad. Si abrís el mismo libro en el iPad, ves las mismas anotaciones.

**Si tenés un device que no es Mac** (Linux, Windows), overrideá la ubicación con `ALEJANDRIA_ICLOUD_DIR`. Las anotaciones se sincronizan via el mecanismo que vos definas (puede ser Dropbox, Syncthing, lo que sea).

### 4.7 Resolver ISBN

El backend tiene una pipeline de 7 capas para resolver el ISBN de un libro que no tiene metadata embebida:

1. **Metadata embebida** (XMP en PDF, OPF en EPUB).
2. **Regex** sobre las primeras 50,000 chars del texto extraído.
3. **OpenLibrary** (búsqueda por título + autor).
4. **Google Books** (búsqueda por título + autor).
5. **Apple Vision OCR** sobre la portada.
6. **Baidu Unlimited-OCR** (cloud, opcional).
7. **Bibliotecas nacionales** (LoC, BNE, BN Argentina) como fuzzy match.

La primera capa que matchea con ISBN válido (checksum correcto) gana. Se cachea en memoria por `(title, author, format)`.

Para usarlo desde la API (futuro endpoint):

```bash
curl -X POST http://localhost:3000/api/admin/organize/analyze \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"folder_path": "/share/biblioteca/raw/Unsorted", "dry_run": true}'
```

### 4.8 Multi-biblioteca

Podés tener varias bibliotecas (ej: "Libros", "Papers", "Comics"):

```bash
# Crear nueva biblioteca
curl -X POST http://localhost:3000/api/libraries \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Papers", "root_path": "/share/biblioteca/papers"}'

# Marcar como activa
curl -X PUT http://localhost:3000/api/libraries/2/active \
  -H "Authorization: Bearer <device-token>"

# Listar todas
curl http://localhost:3000/api/libraries \
  -H "Authorization: Bearer <device-token>"
```

Cuando escaneás una biblioteca específica, el scan solo procesa los archivos en su `root_path`.

### 4.9 Organizar archivos (dry-run → execute)

Si tenés una carpeta con archivos mal organizados (`/share/biblioteca/raw/Mis Documentos/tesis_final.pdf`), podés organizarlos automáticamente:

**1. Dry-run primero** (no mueve nada, solo planifica):

```bash
curl -X POST http://localhost:3000/api/admin/organize/analyze \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"folder_path": "/share/biblioteca/raw/Mis Documentos", "dry_run": true}'
```

Esto devuelve un plan JSON con las acciones propuestas (move, rename, skip).

**2. Revisá el plan**:

```bash
curl http://localhost:3000/api/admin/organize/plans/<plan_id> \
  -H "Authorization: Bearer <admin-token>"
```

**3. Si está OK, ejecutá**:

```bash
curl -X POST http://localhost:3000/api/admin/organize/execute \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"plan_id": "<plan_id>", "approved_action_ids": ["action_1", "action_2"]}'
```

El ejecutor es **idempotente**: si lo corrés dos veces, no rompe nada (mueve lo que falta mover y salta lo que ya está en destino).

**Convención de nombres** (de PR-3-fix-A):

```
{Apellido}, {Nombre}/{Título} ({Año}).{ext}

Ejemplo:
Borges, Jorge Luis/Ficciones (1944).epub
Tolkien, J.R.R./El Señor de los Anillos - La Comunidad del Anillo (1954).epub
```

Si el archivo ya está bien nombrado, se salta. Si no se puede determinar el autor, va a `_anonymous/`.

---

## 5. Servidor NAS en producción

### 5.1 Backups

El estado crítico está en Postgres. Hacé backups regulares:

```bash
# Backup manual
docker exec alejandria-postgres pg_dump -U alejandria alejandria | gzip > backup-$(date +%Y%m%d).sql.gz

# Backup automático diario (agregalo a crontab)
0 2 * * * docker exec alejandria-postgres pg_dump -U alejandria alejandria | gzip > /share/backups/alejandria-$(date +%Y%m%d).sql.gz
```

Los archivos de libros (`.pdf`, `.epub`) en `/share/biblioteca/raw/` no necesitan backup del lado del backend — asumimos que vos ya tenés un backup de tu NAS (RAID, rsync, etc.).

### 5.2 Monitoreo

El backend expone `/metrics` en formato Prometheus. Configurá tu Prometheus para scrapear cada 15 segundos:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'alejandria-nas'
    scrape_interval: 15s
    static_configs:
      - targets: ['<nas-ip>:3000']
    metrics_path: /metrics
```

**Métricas clave**:

- `http_requests_total{method, route, status}` — peticiones HTTP por método/ruta/status.
- `http_request_duration_seconds` — histograma de latencia.
- `scan_jobs_total{kind, status}` — scans iniciados/completados/fallados.
- `downloads_total{state}` — downloads iniciados/en_progreso/completados/falllados.
- `download_bytes` — histograma de bytes descargados.

**Health checks** (para Kubernetes o similar):

```yaml
# livenessProbe
httpGet:
  path: /livez
  port: 3000
initialDelaySeconds: 5
periodSeconds: 10

# readinessProbe
httpGet:
  path: /readyz
  port: 3000
initialDelaySeconds: 10
periodSeconds: 30
```

`/livez` siempre devuelve 200 si el proceso está vivo (no toca la DB). `/readyz` devuelve 503 si Postgres está caído, así el load balancer saca el pod de rotación sin reiniciarlo.

### 5.3 Logs

La aplicación usa Pino con structured JSON logs. Cada log line es parseable:

```json
{
  "timestamp": "2026-06-30T12:34:56.789Z",
  "level": "info",
  "scope": "scan",
  "message": "file queued",
  "request_id": "a1b2c3d4-...",
  "context": { "filePath": "/library/rayuela.epub", "sizeBytes": 524288 }
}
```

Cada request lleva un `X-Request-Id` (generado o pasado por el cliente) que aparece en todos los logs durante el lifetime del request. Esto te permite correlacionar el error del cliente con los logs del servidor.

**Para ver logs en tiempo real**:

```bash
docker compose logs -f nas-backend | jq '.'
```

**Filtrar por request_id**:

```bash
docker compose logs -f nas-backend | jq 'select(.request_id == "a1b2c3d4-...")'
```

### 5.4 Actualizar el backend

```bash
# Desde el directorio del repo en el NAS
cd library
git pull origin main
cd services/nas-backend
docker compose down
docker compose up -d --build

# Las migraciones se aplican automáticamente al arrancar
# (idempotentes via la tabla schema_migrations)
```

### 5.5 Escalar

El backend puede escalar horizontalmente siempre que:

- Compartas el filesystem `/share/biblioteca/raw/` vía NFS.
- Compartas Redis (ya está en docker-compose).
- Compartas Postgres (ya está en docker-compose).

Para correr múltiples réplicas:

```bash
docker compose up -d --scale nas-backend=3
```

Los workers BullMQ distribuyen el trabajo automáticamente. El load balancer debe usar sticky sessions para el endpoint SSE (`/api/admin/scan/events/:job_id`) o todos los pods deben apuntar al mismo broker Redis pub/sub (lo cual es el caso por default).

---

## 6. Operaciones comunes

### 6.1 "Quiero ver qué está pasando con un scan"

```bash
# Ver todos los jobs
curl http://localhost:3000/api/admin/scan/status \
  -H "Authorization: Bearer <admin-token>" | jq

# Ver un job específico con su progreso
curl http://localhost:3000/api/admin/scan/status/<job_id> \
  -H "Authorization: Bearer <admin-token>" | jq

# Stream de eventos en tiempo real
curl -N http://localhost:3000/api/admin/scan/events/<job_id> \
  -H "Authorization: Bearer <admin-token>"
# Verás líneas como:
# event: progress
# data: {"type":"progress","jobId":"...","processedFiles":1500,"totalFiles":30000}
# 
# :keepalive
# 
# (cada 25 segundos)
```

### 6.2 "Tengo un libro que no aparece en la búsqueda"

Probá primero con la búsqueda directa:

```bash
curl "http://localhost:3000/api/search?q=tu+busqueda" \
  -H "Authorization: Bearer <token>" | jq
```

Si no aparece:

1. Verificá que el archivo está en `/share/biblioteca/raw/`.
2. Verificá que el scan corrió sobre esa carpeta (`GET /api/admin/scan/status`).
3. Si el scan terminó pero el libro no aparece, el extractor no pudo identificarlo. Corré el organizador para forzar re-procesamiento.
4. Si sigue sin aparecer, es probable que el archivo esté corrupto. Probá con `python -m alejandria_sidecar extract /path/al/archivo.pdf` para ver el error.

### 6.3 "Quiero resetear el pairing de un device"

```sql
-- Conectate al Postgres
psql -h <nas-ip> -U alejandria -d alejandria

-- Elimina un device específico
DELETE FROM devices WHERE device_id = '<device-id>';

-- O limpia todos los devices (útil si querés que todos re-paren)
TRUNCATE devices CASCADE;
```

Los downloads tracking history se mantiene (FK CASCADE), pero el device que los creó ya no existe. Si querés limpieza total:

```sql
TRUNCATE downloads CASCADE;
TRUNCATE devices CASCADE;
```

### 6.4 "Quiero cambiar el PIN de pair"

1. Editá `.env` y cambiá `NAS_PAIR_PIN`.
2. Reiniciá el backend:
   ```bash
   docker compose restart nas-backend
   ```
3. **Importante**: el backend falla a arrancar si el PIN tiene menos de 8 caracteres (validación fail-fast en producción).
4. Todos los devices existentes tienen que re-pairar con el nuevo PIN.

### 6.5 "Quiero regenerar el cliente TypeScript del SDK"

```bash
cd services/nas-backend
npm run openapi:generate
# Actualiza clients/ts/api.d.ts

# CI guard
npm run openapi:check
# Falla si el SDK no está sincronizado con el spec
```

Esto es útil si agregás un endpoint nuevo o cambiás la forma de la respuesta.

### 6.6 "Quiero contribuir código"

1. Fork + branch desde `develop`.
2. Hacé los cambios siguiendo las convenciones (Strict TDD, conventional commits, no Co-Authored-By).
3. Antes del PR: corré `npm test` y `npm run build` en los packages afectados.
4. Abrí PR contra `develop`. Cada PR debe linkear un issue con `Closes #N`.
5. Antes de release a `main`, el bloque pasa por 4R review (R1 Risk, R2 Readability, R3 Reliability, R4 Resilience) y judgment-day si hay BLOCKERs.

---

## 7. Troubleshooting

### 7.1 "La app de Mac no encuentra el NAS"

- Verificá que la URL del NAS sea accesible: `curl http://<nas-ip>:3000/livez` desde la Mac.
- Si usás Tailscale, verificá que `tailscale status` muestre la Mac y el NAS como connected.
- Verificá que el firewall del NAS permite el puerto 3000 (`sudo iptables -L` o desde la UI del QNAP).
- Verificá que `NAS_PAIR_PIN` en el `.env` del NAS coincide con el que ingresás en la app.

### 7.2 "El scan se cuelga"

- Mirá los logs del worker: `docker compose logs -f nas-backend | grep scan`.
- Si ves errores de Postgres (connection refused), verificá que el contenedor de Postgres esté corriendo: `docker compose ps`.
- Si ves errores de "permission denied" al acceder a `/share/biblioteca/raw/`, verificá los permisos del filesystem:
  ```bash
  ls -la /share/biblioteca/raw/
  # El contenedor del nas-backend debe tener acceso de lectura
  ```

### 7.3 "El PDF se ve en blanco / no carga"

- Verificá que el PDF no esté corrupto: abrílo localmente con un visor estándar.
- Verificá que el download completó: `ls -la ~/Library/Application\ Support/Alejandria/books/`. Si el archivo está en 0 bytes, el download falló.
- Mirá los logs de la app de Mac: en el menú View → Toggle Developer Tools.

### 7.4 "Las anotaciones no se sincronizan entre Mac e iPad"

- Verificá que iCloud Drive esté activado en ambos dispositivos.
- Verificá que la app haya escrito en `~/Library/Mobile Documents/com~apple~cloudDocs/Alejandria/`. Si no, las anotaciones se guardan localmente pero no se sincronizan.
- Esperá unos minutos — iCloud Drive puede tardar en sincronizar archivos pequeños.
- Si usás Tailscale, asegurate de que tu iPad esté conectado a la tailnet.

### 7.5 "El backend no arranca"

- Mirá los logs: `docker compose logs nas-backend`.
- Errores comunes:
  - `NAS_PAIR_PIN too short` — el PIN tiene menos de 8 caracteres. Cambialo en `.env`.
  - `NAS_JWT_SECRET too short` — el secret tiene menos de 32 bytes. Generá uno nuevo con `openssl rand -hex 32`.
  - `Cannot connect to Postgres` — verificá que `DATABASE_URL` apunte al Postgres correcto.
  - `Migration failed` — corré `npm run migrate` manualmente para ver el error específico.

### 7.6 "Las métricas Prometheus no aparecen"

- Verificá que `/metrics` responde: `curl http://localhost:3000/metrics | head`.
- Si devuelve 503 o 404, el backend no arrancó correctamente. Mirá los logs.
- Si tu Prometheus no puede scrapear, verificá que el puerto 3000 sea accesible desde el Prometheus (firewall, Tailscale, etc.).

### 7.7 "Quiero limpiar el catálogo porque se corrompió"

**Opción A: Resetear solo la app web local** (no afecta el NAS):

```bash
rm apps/web/data/library.sqlite*
# Próxima vez que la app abra un libro, se crea de nuevo con el schema vacío.
# Hacé un scan desde el NAS para repoblar.
```

**Opción B: Resetear el NAS entero** (afecta Postgres):

```bash
docker compose down
docker volume rm <compose-volume-name-for-postgres>
docker compose up -d
# El backend crea el schema automáticamente
```

### 7.8 "Quiero cambiar la categoría taxonomía"

La taxonomía seed (`migrations/009_seed_categories.sql`) es **bilingual** (es + en) y jerárquica. Para agregar una nueva:

```sql
-- Conectate al Postgres
psql -h <nas-ip> -U alejandria -d alejandria

-- Ejemplo: agregar "Ciencia de Datos" bajo "Ciencia > Matemáticas"
INSERT INTO categories (path, name_es, name_en, parent_id, depth)
SELECT 'Ciencia/Matemáticas/Ciencia de Datos', 'Ciencia de Datos', 'Data Science', id, 3
FROM categories WHERE path = 'Ciencia/Matemáticas';
```

Después, los scans futuros asignan automáticamente la categoría a los libros que matcheen (vía OpenLibrary / Google Books / metadata embebida).

---

## 8. Referencia de endpoints

### Auth

| Method | Endpoint | Body | Auth |
|--------|----------|------|------|
| `POST` | `/api/auth/pair` | `{pin, device_name}` | Public |
| `POST` | `/api/auth/refresh` | `{token}` | Public |

### Catalog

| Method | Endpoint | Query | Auth |
|--------|----------|-------|------|
| `GET` | `/api/books` | `?page=&limit=&author_id=&format=&language=` | Bearer |
| `GET` | `/api/books/:id` | - | Bearer |
| `GET` | `/api/search` | `?q=&limit=&offset=` | Bearer |
| `GET` | `/api/categories` | - | Bearer |
| `GET` | `/api/libraries` | - | Bearer (lista solo las que el device puede ver) |
| `POST` | `/api/libraries` | `{name, root_path}` | Admin |
| `GET` | `/api/libraries/:id` | - | Bearer |
| `PATCH` | `/api/libraries/:id` | `{name?, root_path?}` | Creator |
| `DELETE` | `/api/libraries/:id` | - | Creator (rechaza si tiene libros) |
| `PUT` | `/api/libraries/:id/active` | - | Bearer |

### Downloads

| Method | Endpoint | Body | Auth |
|--------|----------|------|------|
| `POST` | `/api/downloads` | `{book_id, device_id, device_name, user_id, file_size_bytes}` | Bearer |
| `PATCH` | `/api/downloads/:id` | `{completed, bytes_transferred}` | Bearer (solo el device dueño) |
| `GET` | `/api/downloads/stats` | - | Admin |
| `GET` | `/api/downloads/by-book/:book_id` | - | Admin |
| `GET` | `/api/downloads/by-device/:device_id` | - | Bearer (solo el device dueño) |
| `GET` | `/api/me/downloads` | - | Bearer |
| `GET` | `/api/files/:book_id` | - | Bearer (con `Range: bytes=N-` para resume) |

### Discovery

| Method | Endpoint | Auth |
|--------|----------|------|
| `GET` | `/api/discovery/info` | Public (devuelve `{mdns_name, port}`) |
| `GET` | `/api/discovery/network` | Bearer (devuelve `{tailscale_ip, lan_ips}`) |

### Admin

| Method | Endpoint | Auth |
|--------|----------|------|
| `POST` | `/api/admin/scan/full` | Admin |
| `POST` | `/api/admin/scan/incremental` | Admin |
| `GET` | `/api/admin/scan/status` | Admin |
| `GET` | `/api/admin/scan/status/:job_id` | Admin |
| `POST` | `/api/admin/scan/cancel/:job_id` | Admin |
| `GET` | `/api/admin/scan/events/:job_id` | Admin (SSE stream) |
| `POST` | `/api/admin/organize/analyze` | Admin |
| `POST` | `/api/admin/organize/execute` | Admin |
| `GET` | `/api/admin/organize/plans/:plan_id` | Admin |

### Observability

| Method | Endpoint | Auth |
|--------|----------|------|
| `GET` | `/health` | Public (alias de `/livez`) |
| `GET` | `/livez` | Public |
| `GET` | `/readyz` | Public |
| `GET` | `/metrics` | Public (Prometheus format) |

### Docs

| Method | Endpoint | Auth |
|--------|----------|------|
| `GET` | `/api/docs` | Public (Swagger UI) |
| `GET` | `/api/docs-json` | Public (OpenAPI 3.x spec) |

---

## Apéndice: Comparación con Apple Books / Kindle

| Feature | alejandria-v2 | Apple Books | Kindle |
|---------|---------------|-------------|--------|
| DRM | no (vos sos dueño de tus archivos) | sí (FairPlay) | sí (Kindle DRM) |
| Formatos | PDF, EPUB, MOBI, AZW3, DJVU, CBZ, audio, video | EPUB, PDF | AZW3, KFX |
| Sincronización entre devices | iCloud Drive (modelo Apple Books) | iCloud (sus servers) | Whispersync (Amazon) |
| Anotaciones | sí (highlights, notas, bookmarks) | sí | sí |
| Búsqueda full-text en CJK | sí (pgroonga) | sí | sí |
| Reconocimiento ISBN automático | sí, 7 capas | sí, 1 capa | sí, 1 capa |
| Multi-biblioteca | sí | no | no |
| Auto-organización por autor/título | sí (con dry-run) | sí (sin preview) | no |
| Funciona 100% offline | sí | no (requiere iCloud para sync) | no (requiere Amazon) |
| Tamaño de colección | sin límite | limitado por iCloud storage | limitado por Amazon storage |
| Costo mensual | 0 (costo de tu NAS y electricidad) | 0 (iCloud gratis hasta 5GB) | 0 (Amazon gratis con ads) o 9.99 USD/mes (sin ads) |
| Privacidad | 100% (todo en tu NAS) | media (Apple puede leer metadata) | baja (Amazon lee todo) |

---

**¿Más preguntas?** Mirá los specs en `openspec/changes/alejandria-v2/specs/` o abrí un issue en GitHub.