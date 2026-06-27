# Delta for metadata-extraction

## MODIFIED Requirements

### Requirement: Registry de extractores abierto/cerrado

The system MUST provide an open extractor registry that maps file extensions and magic bytes to one `Extractor` per format. Adding a new format MUST require exactly one new extractor file plus one `register()` call.

(Previously: Python registry only. v2 wraps the Python registry with `python-sidecar-cli`; TS extractors may also implement the `Extractor` protocol.)

#### Scenario: Agregar un nuevo formato es un cambio de un solo archivo

- DADO a developer wants to support `.mobi`
- CUANDO they add `alejandria/extractors/mobi.py` and call `register(MobiExtractor())`
- ENTONCES the registry accepts `.mobi` files
- Y no existing extractor is modified

#### Scenario: El dispatch por formato elige el extractor correcto

- GIVEN a file `paper.pdf` is encountered
- CUANDO the pipeline looks up the extractor
- ENTONCES the PDF extractor is selected
- Y other extractors are not invoked

### Requirement: Un extractor por formato

The system MUST provide exactly one extractor per supported format (PDF, EPUB, CBZ, image, video, audio). Each MUST return one `ExtractedMetadata` so the streaming pipeline holds at most one file's worth of metadata in memory.

(Previously: same contract. TS-side `pdfjs-dist` and `music-metadata` extractors live under `packages/infrastructure/extractors/` for the local first-pass.)

#### Scenario: La extracción de PDF devuelve un ExtractedMetadata

- GIVEN a PDF is encountered
- CUANDO the PDF extractor runs
- ENTONCES it returns one `ExtractedMetadata` with title, author, text snippet, cover bytes, ISBN candidates

#### Scenario: La extracción de EPUB parsea el bloque OPF

- GIVEN an EPUB is encountered
- CUANDO the EPUB extractor runs
- ENTONCES it reads the OPF package document
- Y returns title, author, language, description, ISBN, cover bytes

### Requirement: Descubrimiento de ISBN multi-estrategia

The system MUST discover ISBNs via a pipeline that combines: (1) OPF/XMP embedded, (2) regex over first N pages of extracted text, (3) filename heuristic. The first valid ISBN found MUST be used. If none is found, the entry remains unenriched but is indexed.

(Previously: 3-strategy pipeline. v2 replaces it with the 7-layer `isbn-resolution-pipeline`; the 3-strategy pipeline becomes layers 1–3.)

#### Scenario: El ISBN del OPF tiene preferencia

- GIVEN an EPUB whose OPF declares ISBN `9788445074873`
- CUANDO the ISBN discovery pipeline runs
- ENTONCES `9788445074873` is selected
- Y no further strategy is tried

#### Scenario: La heurística de filename matchea cuando el texto no

- GIVEN a PDF `Campbell-Biology-11th-9780134098653.pdf` with no regex hit
- CUANDO the pipeline runs
- ENTONCES the filename heuristic extracts `9780134098653`

#### Scenario: Sin ISBN la entrada queda sin enriquecer

- GIVEN a PDF with no ISBN anywhere
- CUANDO the pipeline finishes
- ENTONCES no OL lookup is attempted
- AND the file is still indexed

### Requirement: Integración con Spotlight (mdls) en macOS

The system MUST integrate with `mdls` on Apple Silicon and Intel Macs to fill empty fields. Spotlight data MUST NOT override extractor data on conflicts.

(Previously: standalone Spotlight layer. v2 keeps Spotlight as layer 0 and adds Vision + Unlimited-OCR for scanned PDFs.)

#### Scenario: Spotlight completa el autor faltante

- GIVEN a PDF with empty author
- CUANDO `mdls` returns `kMDItemAuthors = ["Jane Doe"]`
- ENTONCES the row records `Jane Doe` as the author

#### Scenario: Spotlight no sobrescribe el título del extractor

- GIVEN a PDF with extractor title `Biology 11th Edition`
- CUANDO `mdls` returns a different title
- ENTONCES the row keeps `Biology 11th Edition`

### Requirement: El contrato de retorno del extractor es un único objeto

Every extractor MUST return one `ExtractedMetadata` dataclass.

#### Scenario: El extractor no streamea múltiples resultados

- GIVEN an EPUB with multiple authors in OPF
- CUANDO the EPUB extractor runs
- ENTONCES it returns ONE `ExtractedMetadata` with the joined author string

## ADDED Requirements

### Requirement: Vision OCR enriches scanned PDFs

The system MUST invoke Vision OCR (or Unlimited-OCR as fallback) when the extractor returns <500 characters of text from a PDF. The OCR layer populates `excerpt` and `full_text`.

#### Scenario: A scanned PDF is OCR'd by Vision

- GIVEN a PDF whose text layer returns 50 characters
- CUANDO the post-extraction OCR step runs
- ENTONCES Vision OCR produces ≥1,000 characters
- AND `extraction_method = 'vision_ocr'`
- AND `ocr_confidence` is recorded

#### Scenario: Unlimited-OCR is the cloud fallback

- GIVEN `UNLIMITED_OCR_ENDPOINT` is set and Vision OCR returns <0.7 confidence
- CUANDO the cloud fallback step runs
- ENTONCES Unlimited-OCR is invoked
- AND `extraction_method = 'unlimited_ocr'`

## Cross-references

- Consumed by: `file-scanning`, `thumbnail-generation`, `isbn-resolution-pipeline`
- Depends on: Spotlight (macOS only); does NOT depend on OpenLibrary
- New dep: `python-sidecar-cli` (OCR), `isbn-resolution-pipeline` (7-layer)