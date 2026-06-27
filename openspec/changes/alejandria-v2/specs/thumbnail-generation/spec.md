# Delta for thumbnail-generation

## MODIFIED Requirements

### Requirement: Layout de thumbnails en disco

The system MUST store thumbnails at `~/Library/Application Support/Alejandria/thumbnails/<library_id>/<hash>.<ext>` where `<hash>` is a content hash of the thumbnail bytes. Default size MUST be 256x256 px and default format MUST be JPEG at quality 85.

(Previously: on-disk only. v2 keeps local FS thumbnails on the device; the NAS stores cover bytes in `books.cover_bytes` (BYTEA) in Postgres.)

#### Scenario: El thumbnail se escribe en la carpeta por biblioteca

- GIVEN a library `Biología` with id `<lib-uuid>`
- CUANDO a thumbnail is generated for `book-001.pdf`
- ENTONCES the file is written at `thumbnails/<lib-uuid>/<hash>.jpg`
- AND the DB row references the relative path

#### Scenario: Thumbnails idénticos se deduplican

- GIVEN two distinct source PDFs produce byte-identical covers
- CUANDO both are generated
- ENTONCES only one file is written
- AND both DB rows reference the same `<hash>.jpg`

### Requirement: Extracción de portada por formato

The system MUST extract cover thumbnails as: PDF first page, EPUB cover from OPF (or first spine image), CBZ first image, Image downsized, Video poster frame, Audio album-art (or generic icon).

#### Scenario: La portada del PDF se extrae de la primera página

- GIVEN a PDF with a recognizable cover page
- CUANDO the thumbnail generator runs
- ENTONCES it renders page 1 at thumbnail resolution

#### Scenario: Audio sin portada usa un ícono genérico

- GIVEN an MP3 with no embedded album art
- CUANDO the generator runs
- ENTONCES a generic audio icon is used
- AND the icon is shared (deduplicated)

### Requirement: Deduplicación basada en hash

The system MUST compute a content hash of the thumbnail bytes before writing. Identical hashes MUST NOT produce duplicate files.

#### Scenario: La deduplicación evita escrituras duplicadas

- GIVEN `thumbnails/<lib-uuid>/abc123.jpg` exists
- CUANDO a new thumbnail has hash `abc123`
- ENTONCES no new file is written

### Requirement: Thumbnail generado al momento del escaneo

The system MUST generate the thumbnail as part of the scan pipeline so the grid has covers after a scan completes.

#### Scenario: La vista de grilla tiene portadas inmediatamente

- GIVEN a scan of 1000 files just completed
- CUANDO the user opens the grid
- ENTONCES every row has a thumbnail

### Requirement: La eliminación de la carpeta de thumbnails es contenida

Thumbnail deletion MUST be scoped to `thumbnails/<library_id>/` when a library is deleted.

#### Scenario: Eliminar una biblioteca remueve solo sus thumbnails

- GIVEN libraries `A` and `B` each with 100 thumbnails
- CUANDO `A` is deleted
- ENTONCES `thumbnails/<A-uuid>/` is removed
- AND `thumbnails/<B-uuid>/` is intact

## ADDED Requirements

### Requirement: NAS stores cover bytes in Postgres

The NAS MUST store every indexed book's cover bytes in `books.cover_bytes BYTEA` with `books.cover_mime TEXT`. Bytes are populated by `nas-scanner-workers` at scan time. `GET /api/books/{id}` MUST include `cover_url` pointing at `/api/books/{id}/cover`.

#### Scenario: A book on the NAS exposes its cover via the API

- GIVEN a book has `cover_bytes IS NOT NULL`
- CUANDO `GET /api/books/{id}` is called
- ENTONCES the response includes `cover_url`
- AND `GET /api/books/{id}/cover` returns 200 with JPEG bytes

#### Scenario: Missing cover returns 404

- GIVEN a book has `cover_bytes IS NULL`
- CUANDO `GET /api/books/{id}/cover` is called
- ENTONCES status is `404`

### Requirement: Cover bytes dedup via content hash

The NAS MUST compute `cover_hash` (xxhash) for every cover. Identical hashes MUST NOT produce duplicate rows in `book_copies`.

#### Scenario: Two books with the same cover share one row

- GIVEN two `books` rows end up with identical `cover_hash`
- CUANDO dedup runs
- ENTONCES the second row references the first row's bytes

## Cross-references

- Depends on: `metadata-extraction` (cover bytes)
- Consumed by: `library-registry`, `pdf-reader` / `epub-reader`, `nas-catalog-service`
- Storage split: local FS on device, Postgres `cover_bytes` on NAS