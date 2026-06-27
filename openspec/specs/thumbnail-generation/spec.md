# Especificación de Generación de Thumbnails

## Propósito

Generates a cover thumbnail for every indexed file at scan time, stores thumbnails on disk in a hash-deduplicated layout under the per-library thumbnail folder, and references each thumbnail from the indexed row. Thumbnails power the catalog grid view and the PDF / EPUB reader placeholder cover.

## Requisitos

### Requisito: Layout de thumbnails en disco

The system MUST store thumbnails at `~/Library/Application Support/Alejandria/thumbnails/<library_id>/<hash>.<ext>` where `<hash>` is a content hash of the thumbnail bytes (not the source file path). The default size MUST be 256x256 px and the default format MUST be JPEG at quality 85.

#### Escenario: El thumbnail se escribe en la carpeta por biblioteca

- DADO a library `Biología` with id `<lib-uuid>`
- CUANDO a thumbnail is generated for `book-001.pdf`
- ENTONCES the file is written at `thumbnails/<lib-uuid>/<hash>.jpg`
- Y the DB row references the relative path `<hash>.jpg`

#### Escenario: Thumbnails idénticos se deduplican

- DADO two distinct source PDFs produce byte-identical cover thumbnails
- CUANDO both thumbnails are generated
- ENTONCES only one file is written to disk
- Y both DB rows reference the same `<hash>.jpg`

### Requisito: Extracción de portada por formato

The system MUST extract cover thumbnails as follows:
- **PDF**: first page rasterized at thumbnail resolution
- **EPUB**: cover image from the OPF `cover` metadata (or first image in the spine)
- **CBZ**: first image in the archive
- **Image** (JPEG/PNG/HEIC/etc.): the image itself, downsized to thumbnail resolution
- **Video**: poster frame at the start of the stream
- **Audio**: embedded album-art if present; otherwise a generic audio icon

#### Escenario: La portada del PDF se extrae de la primera página

- DADO a PDF with a recognizable cover page
- CUANDO the thumbnail generator runs
- ENTONCES it renders page 1 at thumbnail resolution
- Y the resulting bytes are written to disk

#### Escenario: Audio sin portada usa un ícono genérico

- DADO an MP3 with no embedded album art
- CUANDO the thumbnail generator runs
- ENTONCES a generic audio icon is used as the thumbnail
- Y the icon is shared across all audio files without album art (deduplicated)

### Requisito: Deduplicación basada en hash

The system MUST compute a content hash of the thumbnail bytes before writing to disk. If a thumbnail with the same hash already exists in the library's thumbnail folder, the system MUST NOT write a duplicate file and MUST reuse the existing path.

#### Escenario: La deduplicación evita escrituras duplicadas

- DADO the thumbnail folder already contains `thumbnails/<lib-uuid>/abc123.jpg`
- CUANDO the generator computes a new thumbnail whose hash is `abc123`
- ENTONCES no new file is written
- Y the DB row references `abc123.jpg`

### Requisito: Thumbnail generado al momento del escaneo

The system MUST generate the thumbnail as part of the scan pipeline (per-file), so the catalog grid has covers available immediately after a scan completes. The system MUST NOT regenerate thumbnails on demand; the cached thumbnail is authoritative until a re-scan.

#### Escenario: La vista de grilla tiene portadas inmediatamente después del escaneo

- DADO a scan of 1000 files just completed
- CUANDO the user opens the catalog grid view
- ENTONCES every row has a thumbnail available
- Y no row shows a placeholder / loading state after the scan finishes

### Requisito: La eliminación de la carpeta de thumbnails es contenida

The system MUST confine thumbnail deletion to the per-library `thumbnails/<library_id>/` folder when a library is deleted. The system MUST NOT touch any file outside that folder.

#### Escenario: Eliminar una biblioteca remueve solo sus thumbnails

- DADO libraries `A` and `B` exist, each with 100 thumbnails
- CUANDO the user deletes library `A`
- ENTONCES `thumbnails/<A-uuid>/` is removed
- Y `thumbnails/<B-uuid>/` remains intact
- Y no other path under `~/Library/Application Support/Alejandria/` is modified

## Referencias cruzadas

- Depends on: `metadata-extraction` (consumes cover bytes from extractor)
- Consumed by: `library-registry` (deletion), `pdf-reader` / `epub-reader` (cover placeholder)