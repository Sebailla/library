"""CHM extractor wrapper for the sidecar CLI."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from .base import SCHEMA_VERSION, file_unreadable_envelope


def extract_chm(path: Path) -> dict[str, Any]:
    """Run the MVP CHM extractor and return a JSON-ready dict."""
    if not path.exists():
        return file_unreadable_envelope(path)
    try:
        from alejandria.extractors.chm import ChmExtractor  # type: ignore[import-not-found]

        metadata = ChmExtractor().extract(path)
    except Exception as exc:  # noqa: BLE001
        return file_unreadable_envelope(path, exc)

    return {
        "schema_version": SCHEMA_VERSION,
        "format": "chm",
        "path": str(path.resolve()),
        "title": metadata.title,
        "author": metadata.author,
        "extractor_name": metadata.extractor_name,
        "warnings": list(metadata.warnings),
    }


__all__ = ["extract_chm"]