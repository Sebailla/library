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
alejandria-sidecar extract /path/to/book.pdf   # NOT IMPLEMENTED YET
alejandria-sidecar ocr     /path/to/page.png   # NOT IMPLEMENTED YET
alejandria-sidecar scan   /path/to/folder/     # NOT IMPLEMENTED YET
```

Help output:

```
usage: alejandria-sidecar [-h] [--version] COMMAND ...

CLI shim for Python extractors and OCR.

options:
  -h, --help     show this help message and exit
  --version      show program's version number and exit

Commands:
  extract   Run a metadata extractor on a file (NOT IMPLEMENTED YET)
  ocr       Run OCR on an image or PDF (NOT IMPLEMENTED YET)
  scan      Scan a folder and report file types (NOT IMPLEMENTED YET)
```

Stub invocation output (JSON on stdout, exit code 2):

```json
{
  "schema_version": 1,
  "error": {
    "code": "NOT_IMPLEMENTED",
    "message": "extract subcommand is not yet implemented"
  }
}
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 2 | Invalid args / Python version not supported / subcommand not yet implemented |
| 3 | Unknown file format |
| 4 | Requested OCR backend unavailable |
| 5 | File unreadable |

## Running the tests

```bash
cd services/extractors-py
pytest tests/
```

Tests invoke the CLI through `python -m alejandria_sidecar` so the
package does not need to be installed to run them.

## Status

Scaffolding commit only. The `extract`, `ocr`, and `scan` subcommands
return a `NOT_IMPLEMENTED` error envelope. Real extractor and OCR
implementations land in subsequent commits — see
[`openspec/changes/alejandria-v2/tasks.md`](../../openspec/changes/alejandria-v2/tasks.md)
Phase 1 tasks 1.3 onward.