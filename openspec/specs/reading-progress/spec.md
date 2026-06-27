# Especificación de Progreso de Lectura

## Propósito

Remembers the user's last reading position per file (page number for PDFs, CFI for EPUBs, zoom + pan for images) in a per-library `reading_progress` table. Enables "continue where you left off" across sessions, across libraries, and across Mac ↔ iPad via last-write-wins sync.

## Requisitos

### Requisito: Tabla de progreso de lectura por biblioteca

Each library MUST contain a `reading_progress` table with the schema:
```
(file_id PRIMARY KEY, last_position TEXT, last_page INTEGER,
 last_read_at INTEGER, last_device_id TEXT, total_read_seconds INTEGER DEFAULT 0,
 font_size INTEGER, use_handwritten_font BOOLEAN DEFAULT 1)
```
`last_position` MUST be a polymorphic JSON payload (e.g. `{"pdf": "page:47"}` or `{"epub": "cfi:0-4-2"}` or `{"image": {"zoom":1.5,"x":120,"y":340}}`). The table MUST live in the per-library SQLite DB with one row per file (PRIMARY KEY on `file_id`).

#### Escenario: La fila de progreso de lectura se crea en la primera lectura

- DADO the user opens `book-042.pdf` for the first time
- CUANDO the reader finishes mounting the first page
- ENTONCES a row is created in `reading_progress` with `last_position='{"pdf":"page:1"}'`
- Y `last_read_at` is set to the current unix timestamp

#### Escenario: El progreso de lectura se actualiza al cambiar de página

- DADO the user is reading `book-042.pdf` and scrolls from page 1 to page 47
- CUANDO the page change settles (debounced 1s)
- ENTONCES `last_position` is updated to `'{"pdf":"page:47"}'`
- Y `last_read_at` is updated

### Requisito: Affordance de reanudar al reabrir

On file reopen, the reader MUST offer to resume from the saved position via a "Continue on page X" prompt, OR auto-resume according to a user preference stored in the library's settings (default: prompt).

#### Escenario: El reopen por defecto muestra un prompt

- DADO `book-042.pdf` was last read at page 47
- Y the library's `auto_resume` setting is OFF (default)
- CUANDO the user reopens the file
- ENTONCES the reader renders page 1
- Y a non-blocking "Continue on page 47" banner is shown at the top
- Y clicking the banner scrolls to page 47 and dismisses the banner

#### Escenario: El auto-resume evita el prompt

- DADO the library's `auto_resume` setting is ON
- CUANDO the user reopens `book-042.pdf`
- ENTONCES the reader renders page 47 directly, without the prompt

### Requisito: Sync entre dispositivos con last-write-wins

The reading_progress table MUST sync Mac ↔ iPad through the same REST API used by `annotations`. Last-write-wins (by `last_read_at`) MUST resolve conflicts. Concurrent reads at different positions are NOT a v1 concern — single user, sequential device usage.

#### Escenario: El iPad ve la última posición del Mac

- DADO the user read `book-042.pdf` on the Mac up to page 47
- CUANDO the user opens the same file on the iPad (via Tailscale)
- ENTONCES the iPad reader reads the reading_progress row from the library DB
- Y shows the "Continue on page 47" prompt (or auto-resumes, per preference)

#### Escenario: El iPad escribe una nueva posición, el Mac la ve después

- DADO the user continues reading on the iPad and reaches page 73
- CUANDO the iPad reader debounces the page change and PATCHes the API
- ENTONCES the library DB's reading_progress row has `last_position='{"pdf":"page:73"}'`
- Y when the user opens the same file on the Mac later, the prompt says "Continue on page 73"

## Referencias cruzadas

- Depends on: `library-registry` (per-library scope), `annotations` (same REST pattern, same sync semantics)
- Consumed by: `pdf-reader` (page number), `epub-reader` (CFI), future `image-viewer` (zoom + pan coords)