"""DOCX extractor wrapper for the sidecar CLI."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from .base import SCHEMA_VERSION, file_unreadable_envelope


def extract_docx(path: Path) -> dict[str, Any]:
    """Run the MVP DOCX extractor and return a JSON-ready dict."""
    if not path.exists():
        return file_unreadable_envelope(path)
    try:
        from alejandria.extractors.docx import DocxExtractor  # type: ignore[import-not-found]

        metadata = DocxExtractor().extract(path)
    except Exception as exc:  # noqa: BLE001
        return file_unreadable_envelope(path, exc)

    return {
        "schema_version": SCHEMA_VERSION,
        "format": "docx",
        "path": str(path.resolve()),
        "title": metadata.title,
        "author": metadata.author,
        "year": None,
        "extracted_text": metadata.extracted_text,
        "extractor_name": metadata.extractor_name,
        "warnings": list(metadata.warnings),
    }


__all__ = ["extract_docx"]