"""EPUB extractor wrapper for the sidecar CLI.

Thin shim over :class:`alejandria.extractors.epub.EpubExtractor`.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from .base import SCHEMA_VERSION, file_unreadable_envelope


def extract_epub(path: Path) -> dict[str, Any]:
    """Run the MVP EPUB extractor and return a JSON-ready dict."""
    if not path.exists():
        return file_unreadable_envelope(path)
    try:
        from alejandria.extractors.epub import EpubExtractor  # type: ignore[import-not-found]

        metadata = EpubExtractor().extract(path)
    except Exception as exc:  # noqa: BLE001
        return file_unreadable_envelope(path, exc)

    return {
        "schema_version": SCHEMA_VERSION,
        "format": "epub",
        "path": str(path.resolve()),
        "title": metadata.title,
        "author": metadata.author,
        "year": None,
        "isbn": metadata.isbn,
        "extracted_text": metadata.extracted_text,
        "extractor_name": metadata.extractor_name,
        "warnings": list(metadata.warnings),
    }


__all__ = ["extract_epub"]