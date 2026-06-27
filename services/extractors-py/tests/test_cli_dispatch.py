"""Tests for ``alejandria_sidecar.extractors.dispatch``.

The dispatcher is the per-format router the CLI's ``extract`` subcommand
relies on. Each format extension maps to exactly one wrapper, and the
mapping is the single source of truth for "what does the sidecar know
how to extract".

These tests pin three contracts:

1. **Registry contents**: the registered wrappers for ``.epub`` and
   ``.docx`` are the actual ``extract_epub`` and ``extract_docx``
   functions from the per-format modules. Anything else is a silent
   routing bug.
2. **End-to-end routing**: the CLI subprocess invokes the right
   wrapper based on extension. We don't mock the dispatcher — we feed
   real fixtures and assert the wrapper-shaped envelope comes back.
3. **Unknown format fallback**: an unrecognised extension returns an
   ``UNKNOWN_FORMAT`` error envelope and the CLI exits with code 3
   (``EXIT_UNKNOWN_FORMAT``).
"""
from __future__ import annotations

import json
from pathlib import Path


def test_dispatch_registry_maps_epub_to_extract_epub() -> None:
    """``.epub`` must route to ``extractors.epub.extract_epub``."""
    from alejandria_sidecar.extractors import epub as epub_module
    from alejandria_sidecar.extractors.dispatch import dispatch_extract

    # Trigger lazy registry build by calling dispatch once with anything.
    dispatch_extract(Path("does-not-matter.epub"))

    # Reimport the dispatch module to peek at the populated registry.
    import alejandria_sidecar.extractors.dispatch as dispatch_module

    mapping = dispatch_module._EXTRACTORS
    assert ".epub" in mapping, "dispatcher registry is missing .epub"
    assert mapping[".epub"] is epub_module.extract_epub, (
        f".epub must route to extractors.epub.extract_epub; got {mapping['.epub']}"
    )


def test_dispatch_registry_maps_docx_to_extract_docx() -> None:
    """``.docx`` must route to ``extractors.docx.extract_docx``."""
    from alejandria_sidecar.extractors import docx as docx_module
    from alejandria_sidecar.extractors.dispatch import dispatch_extract

    dispatch_extract(Path("does-not-matter.docx"))

    import alejandria_sidecar.extractors.dispatch as dispatch_module

    mapping = dispatch_module._EXTRACTORS
    assert ".docx" in mapping, "dispatcher registry is missing .docx"
    assert mapping[".docx"] is docx_module.extract_docx, (
        f".docx must route to extractors.docx.extract_docx; got {mapping['.docx']}"
    )


def test_cli_extract_routes_epub_through_dispatcher(minimal_epub: Path) -> None:
    """End-to-end: a real EPUB fed to the CLI must surface the EPUB wrapper output."""
    from .conftest import run_cli

    result = run_cli("extract", str(minimal_epub))

    assert result.returncode == 0, (
        f"extract must exit 0 for a valid EPUB; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    # The EPUB wrapper's envelope shape, NOT the dispatcher's unknown-format
    # envelope. If the dispatcher misroutes this, the format key would be
    # 'unknown' or 'epub' would be missing entirely.
    assert payload["format"] == "epub"
    assert payload["extractor_name"] == "epub"
    assert payload["title"] == "Sidecar EPUB Fixture"


def test_cli_extract_routes_docx_through_dispatcher(minimal_docx: Path) -> None:
    """End-to-end: a real DOCX fed to the CLI must surface the DOCX wrapper output."""
    from .conftest import run_cli

    result = run_cli("extract", str(minimal_docx))

    assert result.returncode == 0, (
        f"extract must exit 0 for a valid DOCX; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["format"] == "docx"
    assert payload["extractor_name"] == "docx"
    assert payload["title"] == "Sidecar DOCX Fixture"


def test_cli_extract_unknown_format_returns_unknown_envelope(tmp_path: Path) -> None:
    """An extension the sidecar doesn't know must return UNKNOWN_FORMAT (exit 3)."""
    from .conftest import run_cli

    bogus = tmp_path / "mystery.xyz"
    bogus.write_bytes(b"placeholder")

    result = run_cli("extract", str(bogus))

    assert result.returncode == 3, (
        f"unknown format must exit 3 (EXIT_UNKNOWN_FORMAT); got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert "error" in payload
    assert payload["error"]["code"] == "UNKNOWN_FORMAT"