# python-sidecar-cli Specification

## Purpose

Exposes the existing Python extractor and OCR packages as standalone command-line processes that take a file path on argv and emit a JSON result on stdout. This lets NestJS, Next.js server actions, and local Electron main processes reuse the 12 extractors and the OCR backends without importing Python in-process. The CLI is a thin shim; no extraction or OCR logic lives in this capability.

## Requirements

### Requirement: CLI binary per extractor family

The system MUST provide a CLI binary `alejandria extract <path>` that returns metadata for the file at `<path>` as a single JSON object on stdout. The CLI MUST exit `0` on success and non-zero on extractor failure. The system MUST NOT print log lines to stdout; logs go to stderr.

#### Scenario: Extracting a PDF returns valid JSON

- GIVEN a PDF file exists on disk
- WHEN the user runs `alejandria extract /path/to/book.pdf`
- THEN the CLI prints one JSON object with `title`, `author`, `format`, `pages`, and any `isbn_candidates`
- AND the CLI exits with code `0`
- AND no log lines appear on stdout

#### Scenario: An unsupported extension exits with a documented code

- GIVEN a file with extension `.xyz` is not in the extractor registry
- WHEN the CLI runs
- THEN the CLI exits with code `3`
- AND stderr contains a one-line message naming the unknown format

### Requirement: CLI binary for OCR

The system MUST provide `alejandria ocr <path>` that returns OCR text and confidence as JSON on stdout. The CLI MUST accept a `--backend {vision|tesseract|unlimited}` flag and a `--lang` flag with default `es`.

#### Scenario: OCR on a scanned PDF page returns text + confidence

- GIVEN a scanned PDF is given
- WHEN the user runs `alejandria ocr --backend vision --lang es /path/to/book.pdf`
- THEN the stdout is `{"text": "...", "confidence": 0.91, "backend": "vision"}`
- AND the CLI exits `0`

#### Scenario: Missing backend exits with a documented code

- GIVEN the requested backend is unavailable (e.g. `vision` on a non-darwin host)
- WHEN the CLI runs
- THEN the CLI exits with code `4`
- AND stderr names the missing backend

### Requirement: JSON contract is stable

The JSON schema returned by both binaries MUST be versioned with a top-level `"schema_version"` field (integer, currently `1`). Additive fields MAY appear in future versions without bumping; removing or renaming fields MUST bump the version.

#### Scenario: The schema_version field is present

- GIVEN any successful run of `alejandria extract` or `alejandria ocr`
- WHEN the JSON is parsed
- THEN the first key is `"schema_version": 1`

#### Scenario: Stable parse under missing optional fields

- GIVEN a PDF with no embedded ISBN
- WHEN the extractor runs
- THEN `isbn_candidates` is `null` (not missing)
- AND downstream parsers can rely on the key always existing

### Requirement: Deterministic exit codes

The CLI MUST use a fixed mapping: `0` success, `2` invalid args, `3` unknown format, `4` backend unavailable, `5` file unreadable. Consumers MUST be able to script on these codes without parsing stderr.

#### Scenario: File not found exits 5

- GIVEN the path argument does not exist
- WHEN the CLI runs
- THEN the exit code is `5`
- AND stderr is `error: path not found: <path>`

### Requirement: Sidecar pins Python 3.11–3.13

The sidecar's `pyproject.toml` MUST declare `requires-python = ">=3.11,<3.14"` so that `pyobjc-framework-Vision` continues to install. The system MUST refuse to start on Python 3.14 or newer with a clear error.

#### Scenario: Startup on Python 3.14 fails fast

- GIVEN the interpreter is Python 3.14
- WHEN the CLI runs
- THEN the CLI exits `2`
- AND stderr explains the pyobjc-Vision wheel limitation

## Cross-references

- Depends on: existing `alejandria/extractors/` and `alejandria/ocr/` packages (used as-is)
- Consumed by: `nas-scanner-workers`, `isbn-resolution-pipeline`, local Electron main process