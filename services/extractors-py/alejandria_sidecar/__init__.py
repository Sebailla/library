"""alejandria-sidecar — CLI shim for Python extractors and OCR.

This package exposes the existing ``alejandria/extractors`` and
``alejandria/ocr`` packages as standalone command-line processes. The
sidecar takes a file path on argv and emits a single JSON object on
stdout so that NestJS workers, Next.js server actions, and the local
Electron main process can reuse the Python extractors without an
in-process Python dependency.

See ``openspec/changes/alejandria-v2/specs/python-sidecar-cli/spec.md``
for the full contract.
"""
from __future__ import annotations

__version__ = "0.1.0"

# Exposed for tests / external callers that want to import the parser
# without triggering side effects.
from .cli import build_parser, main  # noqa: E402,F401

__all__ = ["__version__", "build_parser", "main"]