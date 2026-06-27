# Delta for pdf-reader

## MODIFIED Requirements

### Requirement: Renderizado de PDF in-app con PDF.js

The system MUST render PDFs via PDF.js + `react-pdf-highlighter` in a Next.js App Router route. PDF.js MUST be loaded via `next/dynamic({ ssr: false })`.

(Previously: Vite SPA. Now lazy-loaded in Next.js 16.)

#### Scenario: PDF de 100 páginas abre rápido

- GIVEN a 100-page PDF is in the library
- CUANDO the user clicks the file row
- ENTONCES the reader route opens
- AND the first page renders in under 1.5 s p95 on Mac and iPad

#### Scenario: PDF.js está code-split

- GIVEN the user is on the catalog page
- CUANDO the network panel is inspected
- ENTONCES `pdfjs-dist` chunks are NOT loaded until the reader route mounts

### Requirement: Drag-to-highlight multicolor anclado al text layer

The system MUST support drag-to-highlight with five colors (yellow, green, blue, pink, purple) anchored to the text layer.

(Previously: identical. Activity sync now runs through iCloud Drive via `reading-activity`.)

#### Scenario: Drag-to-highlight completa en menos de 200 ms p95

- GIVEN the user drags from character A to character B
- CUANDO the drag completes
- ENTONCES the highlight renders in under 200 ms p95
- AND it persists immediately

#### Scenario: El highlight sobrevive al zoom y al reflow

- GIVEN a highlight was created at 100% zoom
- CUANDO the user zooms to 150% or resizes
- ENTONCES the highlight remains anchored to the same character span

#### Scenario: Hay cinco colores de highlight disponibles

- GIVEN the highlight toolbar is open
- CUANDO the user picks a color
- ENTONCES the next drag uses that color

### Requirement: Navegación de páginas y búsqueda dentro del PDF

The system MUST provide page navigation (jump-to-page, prev/next, scroll) and in-PDF search (`Ctrl/Cmd+F`) with next/previous match.

#### Scenario: El usuario salta a la página 42

- GIVEN the reader is open on a 100-page PDF
- CUANDO the user types `42` and presses Enter
- ENTONCES the reader scrolls to page 42

#### Scenario: El usuario busca dentro del PDF

- GIVEN the reader is open
- CUANDO the user presses `Cmd+F` and types `mitochondria`
- ENTONCES all occurrences are highlighted
- AND `Enter` advances to the next match

### Requirement: Los highlights persisten por libro y sobreviven al reinicio

Highlights MUST be stored in `local-library-db.annotations` keyed by `book_id`. Activity sync MUST run through iCloud Drive JSON via `reading-activity` (LWW by `updated_at`).

(Previously: per-library SQLite + REST. Now collapsed + iCloud Drive.)

#### Scenario: El highlight sobrevive al reinicio de la app

- GIVEN a highlight on `book-042.pdf` page 7
- CUANDO the app restarts
- ENTONCES the highlight is restored

#### Scenario: El highlight aparece en el otro device

- GIVEN a highlight exists on the Mac
- CUANDO the user opens the same file on the iPad
- ENTONCES the highlight renders at the same character span

### Requirement: Presupuesto de latencia de apertura

A PDF MUST open (first page rendered, controls interactive) in under 1.5 s p95 on Mac and iPad for a 100-page document.

#### Scenario: PDF de 100 páginas abre dentro del presupuesto

- GIVEN the user clicks a 100-page PDF
- CUANDO the reader route mounts
- ENTONCES the first page renders within 1.5 s p95

### Requirement: La posición de lectura persiste por archivo

The system MUST remember the last reading position per file in `local-library-db.reading_progress` keyed by `book_id`. The reader MUST offer a "Continue on page X" affordance, or auto-resume per user preference (default: prompt).

(Previously: per-library `reading_progress`. Now collapsed.)

#### Scenario: Prompt de reanudar al reabrir

- GIVEN the user closed `book-042.pdf` on page 47
- CUANDO the user reopens it
- ENTONCES a "Continue on page 47" prompt is shown

#### Scenario: Preferencia de auto-reanudar

- GIVEN "Auto-resume reading position" is ON
- CUANDO any file is reopened
- ENTONCES the reader scrolls to the saved position without prompting

### Requirement: Anotaciones tipo sticky-note con fuente manuscrito

The system MUST allow sticky-note annotations on any PDF page: draggable, resizable rectangle with Markdown text in a handwritten font (default Caveat). Sticky-notes MUST persist in `local-library-db.annotations` and MUST sync via iCloud Drive.

(Previously: per-library `annotations`. Now collapsed + iCloud Drive.)

#### Scenario: El usuario crea un sticky-note

- GIVEN the user clicks "Add note" and clicks position (120, 340) on page 12
- CUANDO the note opens
- ENTONCES a yellow rectangle appears with the input focused

#### Scenario: El usuario tipea con fuente manuscrito

- GIVEN a sticky-note is focused
- CUANDO the user types content
- ENTONCES it renders in Caveat
- AND it auto-saves on blur or after 1 s idle

#### Scenario: El usuario desactiva la fuente manuscrito

- GIVEN "Use handwritten font in notes" is OFF
- CUANDO the user opens or types in any sticky-note
- ENTONCES the text renders in the system sans-serif font

#### Scenario: El sticky-note es arrastrable y redimensionable

- GIVEN a sticky-note exists at (120, 340) with size 200x150
- CUANDO the user drags the header to (250, 200)
- ENTONCES the note moves and the new position persists

#### Scenario: El sticky-note se sincroniza al otro device

- DADO a sticky-note was created on the Mac on page 12
- CUANDO the user opens the same file on the iPad
- ENTONCES the sticky-note appears at the same position with the same text

## Cross-references

- Depends on: `local-library-db`, `metadata-extraction`, `annotations`, `nextjs-app-shell`
- Consumed by: `touch-pencil-ux`
- Caveat font bundled with the frontend