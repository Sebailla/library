# Especificación del Lector de EPUB

## Propósito

Renders EPUB files in-app (Mac and iPad Safari) with `epub.js`, providing chapter / section navigation, per-chapter notes in Markdown, bookmark-style highlights at the section level, and reading-position memory per file. v1 intentionally does NOT implement paragraph-level text-layer highlights with full bbox anchoring — that is v2.

## Requisitos

### Requisito: Renderizado de EPUB in-app con epub.js

The system MUST render EPUBs in the browser via `epub.js` with a chapter / section navigation sidebar. The reader MUST remember the last reading position per file so reopening the EPUB resumes where the user left off.

#### Escenario: El usuario abre un EPUB

- DADO an EPUB is in the library
- CUANDO the user clicks the file row in the catalog
- ENTONCES the EPUB reader route opens
- Y a chapter / section sidebar is visible

#### Escenario: La posición de lectura se recuerda

- DADO the user closed an EPUB while viewing chapter 5, section 2
- CUANDO the user reopens the same EPUB
- ENTONCES the reader scrolls to chapter 5, section 2
- Y the sidebar reflects the current position

### Requisito: Notas por capítulo en Markdown

The system MUST allow the user to attach Markdown notes to a chapter or section. Notes MUST persistse in the per-library `annotations` table with `type='note'`, `body_markdown` set, and `page_or_position` set to the section anchor.

#### Escenario: El usuario agrega una nota al capítulo 3

- DADO the user is viewing chapter 3 of an EPUB
- CUANDO the user opens the note editor and types `**Key idea**: ATP synthase...` and saves
- ENTONCES the note is persisted to the annotations table
- Y it is visible the next time the user opens chapter 3

#### Escenario: El Markdown se renderiza en el panel de notas

- DADO a saved note contains `**bold**` and a list
- CUANDO the note is rendered in the UI
- ENTONCES `**bold**` is rendered as `<strong>bold</strong>`
- Y lists render as `<ul>` items

### Requisito: Highlights tipo marcador a nivel de sección

The system MUST support bookmark-style highlights anchored to chapter / section (not paragraph bbox in v1). Selecting a section MUST add it to the highlights list with a chosen color.

#### Escenario: El usuario marca una sección

- DADO the user is viewing chapter 2, section 4
- CUANDO the user clicks the "bookmark this section" button and picks a color
- ENTONCES a highlight row is added to the highlights panel
- Y the highlight is anchored to the section (chapter + section id)

#### Escenario: La lista de highlights es navegable

- DADO the user has 10 section bookmarks across chapters 1–5
- CUANDO the user clicks any highlight row in the panel
- ENTONCES the reader jumps to that section

### Requisito: Navegación por capítulos

The system MUST provide a clickable chapter / section outline sidebar. Clicking a chapter MUST jump to it; clicking a section MUST jump to it.

#### Escenario: El usuario hace click en el capítulo 4 del sidebar

- DADO the EPUB has 12 chapters
- CUANDO the user clicks chapter 4 in the sidebar
- ENTONCES the reader scrolls to chapter 4's start
- Y the current-position indicator updates

### Requisito: Fuera-de-alcance documentado en la UI

The system MUST surface a clear message in the EPUB reader noting that paragraph-level highlights with bbox anchoring are a v2 feature, so users understand the limitation rather than reporting it as a bug.

#### Escenario: El usuario intenta hacer un highlight de párrafo

- DADO the user drags across a paragraph (not a section)
- CUANDO the drag completes
- ENTONCES the UI shows a tooltip explaining that paragraph highlights are coming in v2
- Y no annotation is silently created

## Referencias cruzadas

- Depends on: `library-registry`, `metadata-extraction` (cover), `annotations` (note + highlight persistence), `ipad-access`
- Consumed by: `touch-pencil-ux`
- v1 limitation: paragraph bbox highlights are explicitly a v2 deliverable; do not promise them in v1