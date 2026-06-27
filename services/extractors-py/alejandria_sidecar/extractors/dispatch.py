"""Per-format dispatch for the sidecar ``extract`` subcommand.

The dispatcher is intentionally tiny — its only job is to pick the
right per-format wrapper based on the file extension. Keeping the
mapping in one place makes it trivial to add a new format and to
audit which formats the sidecar knows about.

Order matters only when two formats would claim the same extension;
today the mapping is one-to-one.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from .base import SCHEMA_VERSION, file_unreadable_envelope

# Extension → wrapper mapping. Wrappers are imported lazily inside the
# function bodies so the CLI's import-time cost stays near zero when
# the caller only asks for ``--help``.
_EXTRACTORS: dict[str, Callable[[Path], dict[str, Any]]] = {}


def _register_default_extractors() -> dict[str, Callable[[Path], dict[str, Any]]]:
    """Return the registry populated with every built-in wrapper.

    Lazy imports — the wrapper modules are only loaded the first time
    ``dispatch_extract`` is called.
    """
    from . import cbz as _cbz
    from . import chm as _chm
    from . import djvu as _djvu
    from . import docx as _docx
    from . import epub as _epub
    from . import image as _image
    from . import pdf as _pdf
    from . import video as _video

    # Audio is optional (no third-party deps yet); see wrapper for the
    # graceful-fallback behaviour when ``mutagen`` is missing.
    try:
        from . import audio as _audio  # type: ignore[import-not-found]
    except ImportError:  # pragma: no cover — only triggered when wrapper unavailable
        _audio = None  # type: ignore[assignment]

    mapping: dict[str, Callable[[Path], dict[str, Any]]] = {
        ".pdf": _pdf.extract_pdf,
        ".epub": _epub.extract_epub,
        ".docx": _docx.extract_docx,
        ".cbz": _cbz.extract_cbz,
        ".chm": _chm.extract_chm,
        ".djvu": _djvu.extract_djvu,
        ".djv": _djvu.extract_djvu,
        ".png": _image.extract_image,
        ".jpg": _image.extract_image,
        ".jpeg": _image.extract_image,
        ".gif": _image.extract_image,
        ".webp": _image.extract_image,
        ".tiff": _image.extract_image,
        ".heic": _image.extract_image,
        ".bmp": _image.extract_image,
        ".mp4": _video.extract_video,
        ".mov": _video.extract_video,
        ".mkv": _video.extract_video,
        ".avi": _video.extract_video,
        ".webm": _video.extract_video,
        ".m4v": _video.extract_video,
    }
    if _audio is not None:
        for ext in (".mp3", ".m4a", ".flac", ".ogg", ".wav", ".aac"):
            mapping[ext] = _audio.extract_audio
    return mapping


def dispatch_extract(path: Path) -> dict[str, Any]:
    """Run the wrapper that claims ``path``'s extension.

    Returns the wrapper's envelope directly so the CLI can emit it
    verbatim. Unknown extensions return an ``UNKNOWN_FORMAT`` error
    envelope rather than raising.
    """
    if not _EXTRACTORS:
        _EXTRACTORS.update(_register_default_extractors())

    suffix = path.suffix.lower()
    wrapper = _EXTRACTORS.get(suffix)
    if wrapper is None:
        return {
            "schema_version": SCHEMA_VERSION,
            "format": suffix.lstrip(".") or "unknown",
            "path": str(path),
            "error": {
                "code": "UNKNOWN_FORMAT",
                "message": f"unknown format: {suffix!r}",
            },
        }

    if not path.exists():
        return file_unreadable_envelope(path)

    return wrapper(path)


__all__ = ["dispatch_extract"]