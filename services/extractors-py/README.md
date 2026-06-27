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

## Usage

```bash
alejandria-sidecar --help
alejandria-sidecar --version
alejandria-sidecar extract /path/to/book.pdf
alejandria-sidecar ocr     /path/to/page.png
alejandria-sidecar scan    /path/to/folder/     # Phase 2
```

Help output:

```
usage: alejandria-sidecar [-h] [--version] COMMAND ...

CLI shim for Python extractors and OCR.

options:
  -h, --help     show this help message and exit
  --version      show program's version number and exit

Commands:
  extract   Run a metadata extractor on a file
  ocr       Run OCR on an image or PDF
  scan      Scan a folder and report file types (NOT IMPLEMENTED YET)
```

### Extract — per-format examples

The `extract` subcommand dispatches on the file extension. Each row
below shows the consumer-visible command for that format; the sidecar
returns the same envelope shape (`schema_version: 1` + format-specific
fields) regardless of format.

```bash
# Books / documents
alejandria-sidecar extract /path/to/book.pdf
alejandria-sidecar extract /path/to/book.epub
alejandria-sidecar extract /path/to/manuscript.docx

# Comics / manga (CBZ is a ZIP of page images)
alejandria-sidecar extract /path/to/issue.cbz

# Help / reference
alejandria-sidecar extract /path/to/manual.chm
alejandria-sidecar extract /path/to/scan.djvu
alejandria-sidecar extract /path/to/scan.djv      # alias for .djvu

# Images
alejandria-sidecar extract /path/to/cover.png
alejandria-sidecar extract /path/to/cover.jpg
alejandria-sidecar extract /path/to/cover.jpeg
alejandria-sidecar extract /path/to/cover.gif
alejandria-sidecar extract /path/to/cover.webp
alejandria-sidecar extract /path/to/cover.tiff
alejandria-sidecar extract /path/to/cover.heic
alejandria-sidecar extract /path/to/cover.bmp

# Audio (requires `mutagen` in the venv)
alejandria-sidecar extract /path/to/podcast.mp3
alejandria-sidecar extract /path/to/podcast.m4a
alejandria-sidecar extract /path/to/podcast.flac
alejandria-sidecar extract /path/to/podcast.ogg
alejandria-sidecar extract /path/to/podcast.wav
alejandria-sidecar extract /path/to/podcast.aac

# Video
alejandria-sidecar extract /path/to/lecture.mp4
alejandria-sidecar extract /path/to/lecture.mov
alejandria-sidecar extract /path/to/lecture.mkv
alejandria-sidecar extract /path/to/lecture.avi
alejandria-sidecar extract /path/to/lecture.webm
alejandria-sidecar extract /path/to/lecture.m4v
```

Every `extract` invocation emits a single JSON object on stdout:

```json
{
  "schema_version": 1,
  "format": "epub",
  "path": "/abs/path/to/book.epub",
  "title": "Sidecar EPUB Fixture",
  "author": "Sidecar Test Suite",
  "extractor_name": "epub",
  "warnings": []
}
```

The `format`, `title`, `author`, and `extractor_name` fields are
format-specific (audio returns duration / bitrate, video returns
codec / dimensions, etc.) — see the corresponding wrapper module in
`alejandria_sidecar/extractors/` for the exact shape.

### OCR — backend selection

The `ocr` subcommand takes a path plus `--backend` and `--lang`
flags. Default backend is `vision` (macOS Vision framework); default
language is `es`.

```bash
# Vision backend (macOS Apple Silicon default)
alejandria-sidecar ocr --backend vision --lang es /path/to/page.png

# Tesseract backend (cross-platform fallback; needs the `tesseract` binary)
alejandria-sidecar ocr --backend tesseract --lang en /path/to/page.png

# PDF input — the sidecar rasterises the requested page range first
alejandria-sidecar ocr --backend vision /path/to/book.pdf

# Unlimited backend (Phase 4 cloud OCR — surfaces BACKEND_UNAVAILABLE today)
alejandria-sidecar ocr --backend unlimited /path/to/page.png
```

On a successful OCR run the CLI emits:

```json
{
  "schema_version": 1,
  "backend": "vision",
  "lang": "es",
  "text": "Recognized text...",
  "confidence": 0.91
}
```

If the requested backend is unavailable (e.g. `unlimited` on this
build, or `vision` on a non-darwin host) the CLI exits with code `4`
and emits a `BACKEND_UNAVAILABLE` envelope.

The per-backend wrapper module (`alejandria_sidecar/extractors/ocr.py`)
is still pending — Phase 1 task 1.4. Until it lands the CLI surfaces
a `NOT_IMPLEMENTED` envelope (exit 2) so consumers can integrate
against the flag set without false confidence. See the spec scenario
"OCR on a scanned PDF page returns text + confidence" for the
contract the wrapper will honour.

## Exit codes

| Code | Constant                  | Meaning                                                                          |
|------|---------------------------|----------------------------------------------------------------------------------|
| 0    | `EXIT_OK`                 | Success — including success-with-warnings envelopes (see below)                  |
| 2    | `EXIT_INVALID_ARGS`       | Invalid args, Python version not supported, subcommand not yet implemented      |
| 3    | `EXIT_UNKNOWN_FORMAT`     | `extract` was called with an extension the dispatcher does not know              |
| 4    | `EXIT_BACKEND_UNAVAILABLE`| `ocr` was called with a backend that is not implemented or not importable       |
| 5    | `EXIT_FILE_UNREADABLE`    | The input path does not exist, or the wrapper raised an unhandled exception      |

The exit code is the authoritative failure category; the JSON
envelope on stdout always carries a `schema_version: 1` payload so
consumers can parse-then-branch on `error.code` regardless of exit
code (useful when the exit code is lost in an async transport).

### Success-with-warnings contract

The sidecar distinguishes "wrapper ran cleanly" from "wrapper ran
and the input was imperfect". A corrupt PDF that the MVP
:class:`PDFExtractor` can still partially decode, or a non-image file
saved with a `.png` extension that Pillow rejects, both exit `0` —
the wrapper *succeeded*, it just couldn't recover everything. The
envelope's `warnings` array names the partial-success conditions:

```json
{
  "schema_version": 1,
  "format": "image",
  "path": "/path/to/broken.png",
  "title": null,
  "author": null,
  "extractor_name": "image",
  "warnings": [
    "could not decode image: cannot identify image file <broken.png>"
  ]
}
```

Consumers must inspect `warnings` and decide per-format whether
non-empty warnings are acceptable (e.g. OCR on a noisy scan) or a
hard failure (e.g. metadata extraction on a corrupted book). Exit
code `0` means "the sidecar did its job"; `warnings` describes how
thoroughly.

Exit code `5` (`EXIT_FILE_UNREADABLE`) is reserved for *infrastructure*
failures: the path is missing, or the wrapper raised an unhandled
exception. Those are never success-with-warnings — the sidecar
couldn't even try.

## Running the tests

```bash
cd services/extractors-py
pytest tests/
```

Tests invoke the CLI through `python -m alejandria_sidecar` so the
package does not need to be installed to run them.

The parametrized dispatch contract matrix
(`tests/test_cli_dispatch.py::test_dispatch_contract_matrix`) is the
at-a-glance coverage check for every supported extension. The OCR
surface tests (`tests/test_extract_ocr.py`) pin the
`--backend`/`--lang` flag contract and the exit-code mapping for
file-missing / backend-unavailable failures.

## Status

Phase 1 (Python sidecar) wrappers: complete for pdf, epub, docx,
cbz, chm, djvu, image, audio, video. The OCR wrapper module
(`alejandria_sidecar/extractors/ocr.py`) is pending — Phase 1 task
1.4 — but the CLI's `ocr` subcommand dispatch contract (flags,
exit codes, file-existence short-circuit, BACKEND_UNAVAILABLE for
`unlimited`) is finalised and pinned by the test suite. See
[`openspec/changes/alejandria-v2/tasks.md`](../../openspec/changes/alejandria-v2/tasks.md)
for the rollout plan and remaining work.
