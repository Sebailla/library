"""Tests for ``alejandria_sidecar.extractors.epub``.

Contract:

* EPUB fixtures return a schema_version=1 envelope with
  ``format: "epub"``, ``title``, ``author``, ``isbn``.
* Missing / unreadable files return a ``FILE_UNREADABLE`` envelope.
* The CLI's ``extract`` subcommand dispatches ``.epub`` to the EPUB
  wrapper.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest


def test_extract_epub_returns_envelope(minimal_epub: Path) -> None:
    from alejandria_sidecar.extractors.epub import extract_epub

    envelope = extract_epub(minimal_epub)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "epub"
    assert envelope["path"] == str(minimal_epub.resolve())
    # The fixture's OPF declares the title and author; the MVP extractor
    # surfaces them through the EPUB regex parser.
    assert envelope["title"] == "Sidecar EPUB Fixture"
    assert envelope["author"] == "Sidecar Test Suite"
    # EPUB has no notion of a single page_count integer; the wrapper
    # therefore MUST NOT leak a ``page_count`` field that the PDF
    # wrapper exposes. The presence/absence is part of the per-format
    # contract.
    assert "page_count" not in envelope


def test_extract_epub_missing_file(tmp_path: Path) -> None:
    from alejandria_sidecar.extractors.epub import extract_epub

    bogus = tmp_path / "nope.epub"
    envelope = extract_epub(bogus)
    assert envelope["schema_version"] == 1
    assert envelope["error"]["code"] == "FILE_UNREADABLE"


def test_cli_extract_dispatches_epub(minimal_epub: Path) -> None:
    from .conftest import run_cli  # type: ignore[import-not-found]

    result = run_cli("extract", str(minimal_epub))
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert payload["format"] == "epub"
    assert payload["title"] == "Sidecar EPUB Fixture"
    assert payload["author"] == "Sidecar Test Suite"