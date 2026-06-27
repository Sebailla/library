"""Tests for ``alejandria_sidecar.extractors.docx``.

Contract:

* DOCX fixtures return a schema_version=1 envelope with
  ``format: "docx"``, ``title``, ``author``, ``extracted_text``.
* Missing files return a ``FILE_UNREADABLE`` envelope.
* The CLI's ``extract`` subcommand dispatches ``.docx`` to the DOCX
  wrapper.
"""
from __future__ import annotations

import json
from pathlib import Path


def test_extract_docx_returns_envelope(minimal_docx: Path) -> None:
    from alejandria_sidecar.extractors.docx import extract_docx

    envelope = extract_docx(minimal_docx)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "docx"
    assert envelope["path"] == str(minimal_docx.resolve())
    assert envelope["title"] == "Sidecar DOCX Fixture"
    assert envelope["author"] == "Sidecar Test Suite"
    # The MVP DOCX extractor joins <w:t> text runs into extracted_text.
    assert envelope["extracted_text"] is not None
    assert "Sidecar DOCX Fixture" in envelope["extracted_text"]


def test_extract_docx_missing_file(tmp_path: Path) -> None:
    from alejandria_sidecar.extractors.docx import extract_docx

    bogus = tmp_path / "nope.docx"
    envelope = extract_docx(bogus)
    assert envelope["schema_version"] == 1
    assert envelope["error"]["code"] == "FILE_UNREADABLE"


def test_cli_extract_dispatches_docx(minimal_docx: Path) -> None:
    from .conftest import run_cli  # type: ignore[import-not-found]

    result = run_cli("extract", str(minimal_docx))
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert payload["format"] == "docx"
    assert payload["title"] == "Sidecar DOCX Fixture"
    assert payload["author"] == "Sidecar Test Suite"