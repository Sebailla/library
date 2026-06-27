"""Per-format extractor wrappers for the sidecar CLI.

Each module in this package wraps one :class:`Extractor` from the
read-only MVP at ``biblioteca/alejandria/extractors/`` and converts
the returned :class:`ExtractedMetadata` into a JSON-friendly ``dict``
that the sidecar CLI emits verbatim on stdout.

The wrappers are intentionally thin:

* They take a single ``path`` argument.
* They return a dict with ``schema_version: 1`` plus the relevant
  fields for the format family.
* Errors propagate as a dict with an ``error`` envelope so the CLI
  can write a stable JSON shape and pick an exit code without
  parsing strings.

No extraction logic lives here — if the MVP extractor needs a new
field, add it there, then surface it from the wrapper.
"""
from __future__ import annotations

from .base import SCHEMA_VERSION, file_unreadable_envelope  # noqa: F401

__all__ = ["SCHEMA_VERSION", "file_unreadable_envelope"]