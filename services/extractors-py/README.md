# alejandria-sidecar

CLI shim that exposes the `alejandria` Python extractors and OCR backends
as standalone command-line processes. Spawned from NestJS workers,
Next.js server actions, and the local Electron main process whenever the
host language needs metadata, OCR, or a file scan without importing
Python in-process.

The full contract lives in
[`openspec/changes/alejandria-v2/specs/python-sidecar-cli/spec.md`](../../openspec/changes/alejandria-v2/specs/python-sidecar-cli/spec.md).

## Installation (development)

```bash
cd services/extractors-py
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

The `requires-python = ">=3.11,<3.14"` pin in `pyproject.toml` reflects
the `pyobjc-framework-Vision` wheel limitation documented in the spec.

The sidecar does not bundle the read-only MVP `alejandria` package as a
runtime dependency. On startup it auto-locates a sibling `biblioteca/`
directory (or honours the `ALEJANDRIA_MVP_ROOT` env var) and prepends it
to `sys.path` so the wrappers can `import alejandria.*`.

## Usage

```bash
alejandria-sidecar --help
alejandria-sidecar --version

# Extract metadata for any supported format — see "Supported formats".
alejandria-sidecar extract /path/to/book.pdf
alejandria-sidecar extract /path/to/book.epub
alejandria-sidecar extract /path/to/comic.cbz

# Run OCR on an image or PDF page.
alejandria-sidecar ocr /path/to/page.png
alejandria-sidecar ocr --backend vision --lang es /path/to/page.png

# Scan a folder (NOT IMPLEMENTED YET — Phase 2).
alejandria-sidecar scan /path/to/library/
```

## Supported formats

| Extensions | Format family | Wrapper | Notes |
|------------|---------------|---------|-------|
| `.pdf` | PDF | `extractors.pdf` | Returns `page_count` + cover-friendly metadata |
| `.epub` | EPUB | `extractors.epub` | OPF regex parse + spine text |
| `.docx` | DOCX | `extractors.docx` | `<w:t>` text runs + `core.xml` metadata |
| `.cbz` | Comic Book ZIP | `extractors.cbz` | First image (sorted) is the cover |
| `.chm` | Compiled HTML Help | `extractors.chm` | ITSF header scan + `<title>` fallback |
| `.djvu`, `.djv` | DjVu | `extractors.djvu` | Falls back to filename stem when `djvulibre` is missing |
| `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.tiff`, `.heic`, `.bmp` | Image | `extractors.image` | Pillow + optional Spotlight |
| `.mp4`, `.mov`, `.mkv`, `.avi`, `.webm`, `.m4v` | Video | `extractors.video` | ffprobe + ffmpeg poster |
| `.mp3`, `.m4a`, `.flac`, `.ogg`, `.wav`, `.aac` | Audio | `extractors.audio` | mutagen tags + embedded art (mutagen optional) |

## Output shape

Successful `extract` runs emit one JSON object on stdout:

```json
{
  "schema_version": 1,
  "format": "pdf",
  "path": "/Users/me/library/book.pdf",
  "title": "Sidecar Fixture",
  "author": "Sidecar Test Suite",
  "year": null,
  "page_count": 1,
  "isbn": null,
  "extracted_text": "Sidecar fixture",
  "extractor_name": "pdf",
  "warnings": []
}
```

OCR runs return:

```json
{
  "schema_version": 1,
  "format": "ocr",
  "path": "/Users/me/scans/page.png",
  "backend": "vision",
  "language": "es",
  "text": "Recognised text ...",
  "confidence": 0.91
}
```

Failures always carry a stable `error` envelope:

```json
{
  "schema_version": 1,
  "format": "pdf",
  "path": "/missing/file.pdf",
  "error": {
    "code": "FILE_UNREADABLE",
    "message": "path not found: /missing/file.pdf"
  }
}
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 2 | Invalid args / Python version not supported / subcommand not yet implemented |
| 3 | Unknown file format (`extract` only) |
| 4 | Requested OCR backend unavailable / OCR runtime failure (`ocr` only) |
| 5 | File unreadable |

## Error codes

The `error.code` strings consumers can match on:

| Code | Subcommand | Meaning |
|------|------------|---------|
| `NOT_IMPLEMENTED` | `scan` | Subcommand is a stub (Phase 2) |
| `FILE_UNREADABLE` | `extract`, `ocr` | Path does not exist or extraction raised |
| `UNKNOWN_FORMAT` | `extract` | Extension is not in the dispatcher registry |
| `BACKEND_UNAVAILABLE` | `ocr` | No OCR backend (Vision / Tesseract) is reachable |
| `OCR_FAILED` | `ocr` | Backend raised during `extract_text` |

## Running the tests

```bash
cd services/extractors-py
pytest tests/
```

Tests invoke the CLI through `python -m alejandria_sidecar` so the
package does not need to be installed to run them. The conftest
generates tiny fixtures on the fly (1-page PDF via PyMuPDF, 1-chapter
EPUB via stdlib `zipfile`, etc.) so the suite ships without binary
book assets.

## Status

`extract` and `ocr` subcommands ship with wrappers for every documented
format family. `scan` remains a `NOT_IMPLEMENTED` stub until Phase 2.