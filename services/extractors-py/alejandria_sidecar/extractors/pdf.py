"""PDF extractor wrapper for the sidecar CLI.

Wraps :class:`alejandria.extractors.pdf.PdfExtractor` and converts the
returned :class:`ExtractedMetadata` into a JSON-friendly dict the CLI
emits verbatim on stdout. Adds the integer ``page_count`` (which the
MVP's :class:`ExtractedMetadata` does not store) by reopening the PDF
briefly with :mod:`pymupdf`. Cover bytes are deliberately omitted from
the JSON output — they're large and the sidecar's job is metadata, not
thumbnail delivery (that's the thumbnail worker's job in a later phase).
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from .base import SCHEMA_VERSION, file_unreadable_envelope

log = logging.getLogger(__name__)


def extract_pdf(path: Path) -> dict[str, Any]:
    """Run the MVP PDF extractor on ``path`` and return a JSON-ready dict.

    Missing or unreadable files return a ``FILE_UNREADABLE`` error
    envelope instead of raising — the CLI must exit non-zero but never
    crash on a single bad file.
    """
    if not path.exists():
        return file_unreadable_envelope(path)

    try:
        # Lazy import keeps the sidecar import-time cost zero when the
        # caller only asks for ``--help`` or ``--version``.
        import pymupdf  # type: ignore[import-not-found]

        # Page count is the only field missing from ExtractedMetadata
        # that the spec promises. We open the file a second time
        # briefly so the metadata object the MVP builds stays
        # untouched (no schema mutation in MVP land).
        with pymupdf.open(path) as doc:
            page_count = doc.page_count
    except Exception as exc:  # noqa: BLE001 — surface any open error as FILE_UNREADABLE
        log.warning("pdf: open failed for %s: %s", path, exc)
        return file_unreadable_envelope(path, exc)

    try:
        # Importing ``alejandria.extractors.pdf`` registers the
        # extractor with the global registry on first import.
        from alejandria.extractors.pdf import PdfExtractor  # type: ignore[import-not-found]

        metadata = PdfExtractor().extract(path)
    except Exception as exc:  # noqa: BLE001
        log.warning("pdf: extract failed for %s: %s", path, exc)
        return file_unreadable_envelope(path, exc)

    return {
        "schema_version": SCHEMA_VERSION,
        "format": "pdf",
        "path": str(path.resolve()),
        "title": metadata.title,
        "author": metadata.author,
        "year": None,  # not extracted by the MVP today
        "page_count": page_count,
        "isbn": metadata.isbn,
        "extracted_text": metadata.extracted_text,
        "extractor_name": metadata.extractor_name,
        "warnings": list(metadata.warnings),
    }


__all__ = ["extract_pdf"]