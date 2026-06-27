"""OCR wrapper for the sidecar CLI.

Thin shim over :mod:`alejandria.ocr`. Translates the
:class:`OCRResult` dataclass into a JSON-ready dict the CLI emits on
stdout. Backend selection honours the ``--backend`` flag and falls
back through the MVP's preference order when the caller does not pick
one.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from .base import SCHEMA_VERSION, file_unreadable_envelope


def extract_ocr(path: Path, *, backend: str | None = None, lang: str = "es") -> dict[str, Any]:
    """Run OCR on ``path`` and return a JSON-ready dict.

    Missing files return a ``FILE_UNREADABLE`` envelope. When the
    requested backend is missing on this host, the wrapper returns a
    ``BACKEND_UNAVAILABLE`` envelope so the CLI can pick exit code 4
    without inspecting strings.
    """
    if not path.exists():
        return file_unreadable_envelope(path)

    try:
        from alejandria.ocr import (  # type: ignore[import-not-found]
            OCRUnavailableError,
            pick_best_backend,
        )
    except ImportError as exc:  # pragma: no cover — MVP not importable
        return {
            "schema_version": SCHEMA_VERSION,
            "path": str(path),
            "error": {
                "code": "BACKEND_UNAVAILABLE",
                "message": f"alejandria.ocr not importable: {exc!r}",
            },
        }

    try:
        ocr_backend = pick_best_backend(preferred=backend)
    except OCRUnavailableError as exc:
        return {
            "schema_version": SCHEMA_VERSION,
            "path": str(path),
            "error": {
                "code": "BACKEND_UNAVAILABLE",
                "message": str(exc),
            },
        }

    try:
        result = ocr_backend.extract_text(path, language=lang)
    except Exception as exc:  # noqa: BLE001 — never let OCR crash the sidecar
        return {
            "schema_version": SCHEMA_VERSION,
            "path": str(path),
            "error": {
                "code": "OCR_FAILED",
                "message": f"OCR backend {ocr_backend.name!r} failed: {exc!r}",
            },
        }

    return {
        "schema_version": SCHEMA_VERSION,
        "format": "ocr",
        "path": str(path.resolve()),
        "backend": result.engine,
        "language": lang,
        "text": result.text,
        "confidence": result.confidence,
    }


__all__ = ["extract_ocr"]