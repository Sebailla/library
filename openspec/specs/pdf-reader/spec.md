# Especificación del Lector de PDF

## Propósito

Renders PDF files in-app (Mac and iPad Safari) with PDF.js and `react-pdf-highlighter`, providing multi-color text highlights anchored to the text layer (page + offset + length, not pixel rectangles), page navigation, in-PDF search, and a perf budget that keeps reads interactive even on iPad over Tailscale.

## Requisitos

### Requisito: Renderizado de PDF in-app con PDF.js

The system MUST render PDFs in the browser via PDF.js wrapped by `react-pdf-highlighter`. The PDF.js worker MUST be code-split so it is loaded only on the reader route, not in the main catalog bundle. PDF rendering MUST cover all pages and MUST NOT require leaving the catalog UI.

#### Escenario: El usuario abre un PDF de 100 páginas

- DADO a 100-page PDF is in the library
- CUANDO the user clicks the file row in the catalog
- ENTONCES the PDF reader route opens
- Y the first page renders in under 1.5 s p95 on Mac and iPad
- Y all 100 pages are available for navigation (not just the first)

#### Escenario: PDF.js está code-split

- DADO the user is on the catalog page and has not opened a PDF yet
- CUANDO the network panel is inspected
- ENTONCES `pdfjs-dist` and `react-pdf-highlighter` chunks are NOT loaded
- Y they load only when the user enters the reader route

### Requisito: Drag-to-highlight multicolor anclado al text layer

The system MUST support drag-to-highlight with five colors (yellow, green, blue, pink, purple) via `react-pdf-highlighter`. Highlights MUST be anchored to the text layer (page + character offset + length), not pixel rectangles, so they remain stable across zoom and reflow.

#### Escenario: Drag-to-highlight completa en menos de 200 ms p95

- DADO the user is viewing a PDF page
- CUANDO the user drags from character A to character B
- ENTONCES the highlight is rendered (with the chosen color) in under 200 ms p95
- Y the highlight persists immediately (POST to `/api/libraries/<id>/files/<fid>/annotations`)

#### Escenario: El highlight sobrevive al zoom y al reflow

- DADO a highlight was created at 100% zoom
- CUANDO the user zooms to 150% or resizes the window
- ENTONCES the highlight remains anchored to the same character span (not displaced)
- Y the highlighted text is still selected in the new layout

#### Escenario: Hay cinco colores de highlight disponibles

- DADO the highlight toolbar is open
- CUANDO the user picks a color
- ENTONCES the next drag-to-highlight uses that color
- Y the available colors are exactly: yellow, green, blue, pink, purple

### Requisito: Navegación de páginas y búsqueda dentro del PDF

The system MUST provide page navigation (jump-to-page input, prev/next buttons, scroll) and in-PDF search (`Ctrl/Cmd+F`). Search MUST highlight matches and scroll to the next/previous match.

#### Escenario: El usuario salta a la página 42

- DADO the PDF reader is open on a 100-page PDF
- CUANDO the user types `42` in the jump-to-page input and presses Enter
- ENTONCES the reader scrolls to page 42
- Y the page indicator updates to `42 / 100`

#### Escenario: El usuario busca dentro del PDF

- DADO the PDF reader is open
- CUANDO the user presses `Cmd+F` and types `mitochondria`
- ENTONCES all occurrences are highlighted
- Y `Enter` advances to the next match
- Y `Shift+Enter` goes to the previous match

### Requisito: Los highlights persisten por biblioteca y sobreviven al reinicio

Highlights MUST be stored in the per-library `annotations` table (see `annotations` capability) keyed by file id. Highlights MUST survive app restart, library switch, and Mac↔iPad sync via the same REST API.

#### Escenario: El highlight sobrevive al reinicio de la app

- DADO the user creates a highlight on `book-042.pdf` page 7
- CUANDO the app is restarted
- ENTONCES the highlight is restored when `book-042.pdf` is reopened
- Y it is anchored to the same character span

#### Escenario: El highlight aparece en el otro device

- DADO a highlight exists on the Mac
- CUANDO the user opens the same file on the iPad (via Tailscale)
- ENTONCES the highlight is rendered at the same character span
- Y selecting "last write wins" resolves any conflict (single-user)

### Requisito: Presupuesto de latencia de apertura

A PDF MUST open (first page rendered, controls interactive) in under 1.5 s p95 on Mac and iPad for a 100-page document. Slow PDFs MUST show a loading indicator; they MUST NOT block the rest of the UI.

#### Escenario: PDF de 100 páginas abre dentro del presupuesto

- DADO the user clicks a 100-page PDF
- CUANDO the reader route mounts
- ENTONCES the first page is rendered within 1.5 s p95
- Y subsequent pages render progressively (no UI freeze)

### Requisito: La posición de lectura persiste por archivo

The system MUST remember the last reading position (page number for PDF, CFI for EPUB) per file in the per-library `reading_progress` table (one row per `file_id`). On reopen, the reader MUST offer to resume from the saved position via a "Continue on page X" affordance, or auto-resume according to a user preference (default: prompt).

#### Escenario: Prompt de reanudar al reabrir

- DADO the user closed `book-042.pdf` on page 47
- CUANDO the user reopens the same file in the reader
- ENTONCES a "Continue on page 47" prompt is shown
- Y accepting it scrolls to page 47
- Y declining it scrolls to page 1

#### Escenario: Preferencia de auto-reanudar

- DADO the user has set "Auto-resume reading position" to ON in preferences
- CUANDO any file is reopened in the reader
- ENTONCES the reader scrolls directly to the saved position without prompting

#### Escenario: La posición de lectura se sincroniza entre dispositivos

- DADO the user reads `book-042.pdf` on the Mac up to page 47
- CUANDO the user opens the same file on the iPad (via Tailscale)
- ENTONCES the iPad reader shows the "Continue on page 47" prompt
- Y last-write-wins resolves the conflict if the iPad had a different saved position

### Requisito: Anotaciones tipo sticky-note con fuente estilo manuscrito

The system MUST allow the user to attach **sticky-note** annotations to any PDF page. A sticky-note MUST be a draggable, resizable rectangle overlay anchored to a page, containing Markdown text typed by the user. The text MUST be rendered with a handwritten-style font (default: Caveat) that the user can toggle off in preferences to fall back to the system sans-serif. Sticky-notes MUST persist in the per-library `annotations` table (see `annotations` capability) and MUST survive app restart and Mac↔iPad sync.

#### Escenario: El usuario crea un sticky-note

- DADO the user is reading `book-042.pdf` on page 12
- CUANDO the user activates "Add note" mode and clicks position (x=120, y=340) on the page
- ENTONCES a sticky-note rectangle appears at that position with default yellow background
- Y the text input is focused for typing

#### Escenario: El usuario tipea el contenido de la nota con fuente manuscrita

- DADO a sticky-note is open and focused
- CUANDO the user types `Remember to re-read section 3.2 about glycolysis`
- ENTONCES the text appears rendered in the Caveat font
- Y the typed content is auto-saved to the `annotations` table on blur or after 1s of idle

#### Escenario: El usuario desactiva la fuente manuscrita

- DADO the user has set "Use handwritten font in notes" to OFF in preferences
- CUANDO the user opens or types in any sticky-note
- ENTONCES the text renders in the system sans-serif font
- Y existing notes created with the handwritten font also render in sans-serif

#### Escenario: El sticky-note es arrastrable y redimensionable

- DADO a sticky-note exists at position (120, 340) with size 200x150
- CUANDO the user drags the note header to position (250, 200)
- ENTONCES the note moves to (250, 200) and the new position is persisted

#### Escenario: El sticky-note se sincroniza al otro device

- DADO the user created a sticky-note on page 12 of `book-042.pdf` on the Mac
- CUANDO the user opens the same file on the iPad (via Tailscale)
- ENTONCES the sticky-note appears at the same position with the same text
- Y renders with the same handwritten-style font (respecting the iPad's preference)

## Referencias cruzadas

- Depends on: `library-registry` (active library context), `metadata-extraction` (cover thumbnail), `annotations` (note + highlight persistence), `reading_progress` schema, `ipad-access` (iPad reach)
- Consumed by: `touch-pencil-ux` (Pencil-as-touch-pointer input handling)
- New dep: Caveat font (Google Fonts, OFL license, ~300 KB woff2) bundled with the frontend