"""Video extractor wrapper for the sidecar CLI."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from .base import SCHEMA_VERSION, file_unreadable_envelope


def extract_video(path: Path) -> dict[str, Any]:
    """Run the MVP video extractor and return a JSON-ready dict."""
    if not path.exists():
        return file_unreadable_envelope(path)
    try:
        from alejandria.extractors.video import VideoExtractor  # type: ignore[import-not-found]

        metadata = VideoExtractor().extract(path)
    except Exception as exc:  # noqa: BLE001
        return file_unreadable_envelope(path, exc)

    return {
        "schema_version": SCHEMA_VERSION,
        "format": "video",
        "path": str(path.resolve()),
        "title": metadata.title,
        "author": metadata.author,
        "duration_seconds": metadata.duration_seconds,
        "extractor_name": metadata.extractor_name,
        "warnings": list(metadata.warnings),
    }


__all__ = ["extract_video"]