# Especificación de Extracción de Metadata

## Propósito

Extracts file-format-specific metadata from every supported file type via a pluggable extractor registry. Each extractor returns a single `ExtractedMetadata` value per file so memory stays flat; format-specific quirks (PDF cover page, EPUB OPF block, CBZ first image, image EXIF, video poster frame, audio tags) are isolated behind a uniform protocol so adding a new format is a one-file change.

## Requisitos

### Requisito: Registry de extractores abierto/cerrado

The system MUST provide an open extractor registry that maps file extensions and magic bytes to a single `Extractor` per format. Adding a new format MUST require exactly one new extractor file plus one `register()` call. The system MUST NOT require modifying any existing extractor to add a new one.

#### Escenario: Agregar un nuevo formato es un cambio de un solo archivo

- DADO a developer wants to support `.mobi` files
- CUANDO they add `alejandria/extractors/mobi.py` containing an `Extractor` subclass and call `register(MobiExtractor())`
- ENTONCES the registry accepts `.mobi` files in subsequent scans
- Y no existing extractor file is modified

#### Escenario: El dispatch por formato elige el extractor correcto

- DADO a file `paper.pdf` is encountered during a scan
- CUANDO the pipeline looks up the extractor registry
- ENTONCES the PDF extractor is selected (via extension and/or magic bytes)
- Y the EPUB, image, and audio extractors are not invoked

### Requisito: Un extractor por formato

The system MUST provide exactly one extractor per supported format: **PDF**, **EPUB**, **CBZ**, **image** (JPEG/PNG/HEIC/etc.), **video** (MP4/MKV/etc.), and **audio** (MP3/M4A/FLAC/etc.). Each extractor MUST return a single `ExtractedMetadata` value (never a list) so the streaming pipeline can hold at most one file's worth of metadata in memory at a time.

#### Escenario: La extracción de PDF devuelve un ExtractedMetadata

- DADO a PDF file is encountered
- CUANDO the PDF extractor runs
- ENTONCES it returns exactly one `ExtractedMetadata` containing title, author (if available), extracted text snippet, cover bytes, and any embedded ISBN candidates
- Y the per-file references fall out of scope before the next file is yielded

#### Escenario: La extracción de EPUB parsea el bloque OPF

- DADO an EPUB file is encountered
- CUANDO the EPUB extractor runs
- ENTONCES it reads the OPF package document for canonical metadata
- Y it returns title, author, language, description, ISBN (if present in OPF), and the cover image bytes
- Y the OPF data is exposed for the ISBN discovery pipeline

### Requisito: Descubrimiento de ISBN multi-estrategia

The system MUST discover ISBNs via a multi-strategy pipeline that combines, in order: (1) EPUB OPF package document, (2) regex match against the first N pages of extracted text, (3) filename heuristic match. The first valid ISBN found MUST be used for OpenLibrary lookup. If no ISBN is found, the entry remains unenriched but is still indexed.

#### Escenario: El ISBN del OPF tiene preferencia

- DADO an EPUB whose OPF declares ISBN `9780134098653`
- CUANDO the ISBN discovery pipeline runs
- ENTONCES `9780134098653` is selected as the canonical ISBN
- Y no further strategy is tried for that file

#### Escenario: La heurística de filename matchea cuando el texto no

- DADO a PDF named `Campbell-Biology-11th-9780134098653.pdf` whose extracted text has no ISBN match
- CUANDO the ISBN discovery pipeline runs
- ENTONCES the filename heuristic extracts `9780134098653`
- Y the file is queued for OpenLibrary lookup

#### Escenario: Sin ISBN la entrada queda sin enriquecer

- DADO a PDF with no ISBN in metadata, no regex hit, and no filename match
- CUANDO the ISBN discovery pipeline finishes
- ENTONCES no OpenLibrary lookup is attempted for that file
- Y the file is still indexed with the raw extractor metadata

### Requisito: Integración con Spotlight (mdls) en macOS

The system MUST integrate with macOS Spotlight (`mdls`) on Apple Silicon and Intel Macs to augment extractor metadata with Spotlight-known attributes (e.g., `kMDItemAuthors`, `kMDItemTitle`, `kMDItemDescription`) when they are available. Spotlight data MUST NOT override extractor data when both exist; it MAY fill empty fields.

#### Escenario: Spotlight completa el autor faltante

- DADO a PDF whose extractor returned an empty author
- CUANDO `mdls` returns `kMDItemAuthors = ["Jane Doe"]`
- ENTONCES the indexed row records `Jane Doe` as the author

#### Escenario: Spotlight no sobrescribe el título del extractor

- DADO a PDF whose extractor returned title `Biology 11th Edition`
- CUANDO `mdls` returns a different title
- ENTONCES the indexed row keeps `Biology 11th Edition` (extractor wins on conflicts)

### Requisito: El contrato de retorno del extractor es un único objeto

The system MUST require every extractor to return a single `ExtractedMetadata` dataclass (not a list, not a generator). This contract is what guarantees the streaming pipeline's flat memory profile.

#### Escenario: El extractor no streamea múltiples resultados

- DADO an EPUB with multiple authors in the OPF
- CUANDO the EPUB extractor runs
- ENTONCES it returns ONE `ExtractedMetadata` with the joined author string
- Y it does NOT yield multiple objects

## Referencias cruzadas

- Consumed by: `file-scanning` (called per-file), `thumbnail-generation` (uses cover bytes)
- Depends on: Spotlight (macOS only); does NOT depend on OpenLibrary (separate concern)