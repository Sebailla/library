"""Shared utilities for per-format extractor wrappers.

These helpers are kept here (rather than scattered across every
wrapper module) so each format wrapper stays a thin ``extract_<fmt>``
function with no duplicated boilerplate.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1


def file_unreadable_envelope(path: Path, exc: BaseException | None = None) -> dict[str, Any]:
    """Return the standard ``FILE_UNREADABLE`` error envelope.

    Every wrapper uses the same shape so the CLI can pick the right
    exit code without inspecting the message string.
    """
    msg = f"path not found: {path}"
    if exc is not None:
        msg = f"{msg}: {exc!r}"
    return {
        "schema_version": SCHEMA_VERSION,
        "format": _format_from_path(path),
        "path": str(path),
        "error": {
            "code": "FILE_UNREADABLE",
            "message": msg,
        },
    }


def _format_from_path(path: Path) -> str:
    """Lower-cased extension without the dot (e.g. ``pdf``, ``epub``).

    Used purely as a hint for error envelopes and consumer-side
    debugging. Returns ``"unknown"`` when the extension is missing so
    the field is always present.
    """
    suffix = path.suffix.lower().lstrip(".")
    return suffix or "unknown"


__all__ = ["SCHEMA_VERSION", "file_unreadable_envelope"]