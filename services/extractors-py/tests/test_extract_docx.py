"""Tests for ``alejandria_sidecar.extractors.docx``.

The DOCX wrapper is the entry point used by the sidecar CLI to convert
an :class:`ExtractedMetadata` (from the MVP ``alejandria.extractors.docx``
module) into a JSON-friendly dict the CLI emits on stdout.

These tests drive the wrapper through its public function
:func:`extract_docx` and assert the contract the spec promises:

* JSON envelope carries ``schema_version: 1``.
* The wrapped payload contains ``title``, ``author``, ``format: "docx"``
  and a non-empty ``extracted_text`` when the fixture's body is valid.
* A missing file produces an error envelope with
  ``code: "FILE_UNREADABLE"`` (mapped to exit code 5).
* A corrupt (non-ZIP) file does not crash the wrapper — the MVP
  extractor converts the parse failure into a non-empty ``warnings``
  list while still returning a well-formed envelope.
"""
from __future__ import annotations

import json
from pathlib import Path


def test_extract_docx_returns_envelope_for_real_fixture(minimal_docx: Path) -> None:
    """Happy path: a minimal valid DOCX must yield title + author + body text."""
    from alejandria_sidecar.extractors.docx import extract_docx

    envelope = extract_docx(minimal_docx)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "docx"
    assert envelope["path"] == str(minimal_docx.resolve())
    assert envelope["title"] == "Sidecar DOCX Fixture"
    assert envelope["author"] == "Sidecar Test Suite"
    # The fixture's body text must surface in the wrapper's text field
    # so the FTS5 index has something to search.
    assert envelope["extracted_text"]
    assert "Sidecar DOCX Fixture" in envelope["extracted_text"]
    # The wrapper always declares which extractor produced the envelope.
    assert envelope["extractor_name"] == "docx"


def test_extract_docx_missing_file_returns_file_unreadable(tmp_path: Path) -> None:
    """Missing files must surface as a FILE_UNREADABLE error envelope."""
    from alejandria_sidecar.extractors.docx import extract_docx

    bogus = tmp_path / "nope.docx"
    envelope = extract_docx(bogus)

    assert envelope["schema_version"] == 1
    assert "error" in envelope
    assert envelope["error"]["code"] == "FILE_UNREADABLE"
    assert str(bogus) in envelope["error"]["message"]


def test_extract_docx_corrupt_file_surfaces_warning(tmp_path: Path) -> None:
    """Corrupt (non-ZIP) files must NOT crash the wrapper.

    The MVP :class:`DocxExtractor` catches ZIP parse failures and
    records them as warnings, so the wrapper still returns a
    well-formed envelope. This pins that contract: callers can rely on
    a dict, not on an exception, even for garbage input.
    """
    from alejandria_sidecar.extractors.docx import extract_docx

    corrupt = tmp_path / "broken.docx"
    corrupt.write_bytes(b"this is not a valid zip archive")

    envelope = extract_docx(corrupt)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "docx"
    assert envelope["path"] == str(corrupt.resolve())
    # The MVP catches the parse failure and emits a warning — the
    # wrapper must propagate it, not swallow it silently.
    assert isinstance(envelope["warnings"], list)
    assert any("not a valid zip" in w for w in envelope["warnings"]), (
        f"expected a 'not a valid zip' warning, got: {envelope['warnings']!r}"
    )


def test_cli_extract_dispatches_docx(minimal_docx: Path) -> None:
    """The CLI's ``extract`` subcommand must dispatch ``.docx`` to the DOCX wrapper."""
    from .conftest import run_cli  # type: ignore[import-not-found]

    result = run_cli("extract", str(minimal_docx))

    assert result.returncode == 0, (
        f"extract must exit 0; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert payload["format"] == "docx"
    assert payload["title"] == "Sidecar DOCX Fixture"
    assert payload["extractor_name"] == "docx"