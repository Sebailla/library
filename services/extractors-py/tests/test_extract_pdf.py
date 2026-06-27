"""Tests for ``alejandria_sidecar.extractors.pdf``.

The PDF wrapper is the entry point used by the sidecar CLI to convert
an ``ExtractedMetadata`` (from the MVP ``alejandria.extractors.pdf``
module) into a JSON-friendly dict the CLI emits on stdout.

These tests drive the wrapper through its public function
:func:`extract_pdf` and assert the contract the spec promises:

* JSON envelope carries ``schema_version: 1``.
* The wrapped payload contains ``title``, ``author``, ``format: "pdf"``
  and ``page_count``.
* ``page_count`` is the integer number of pages in the source PDF.
* A missing or unreadable file produces an error envelope with
  ``code: "FILE_UNREADABLE"`` (mapped to exit code 5).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest


def test_extract_pdf_returns_envelope_for_real_fixture(minimal_pdf: Path) -> None:
    from alejandria_sidecar.extractors.pdf import extract_pdf

    envelope = extract_pdf(minimal_pdf)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "pdf"
    assert envelope["path"] == str(minimal_pdf.resolve())
    assert envelope["title"] == "Sidecar Fixture"
    assert envelope["author"] == "Sidecar Test Suite"
    # The fixture PDF contains a single page; the wrapper must surface
    # the integer page count rather than a boolean or a list.
    assert isinstance(envelope["page_count"], int)
    assert envelope["page_count"] == 1


def test_extract_pdf_missing_file_returns_file_unreadable(tmp_path: Path) -> None:
    from alejandria_sidecar.extractors.pdf import extract_pdf

    bogus = tmp_path / "nope.pdf"
    envelope = extract_pdf(bogus)

    assert envelope["schema_version"] == 1
    assert "error" in envelope
    assert envelope["error"]["code"] == "FILE_UNREADABLE"
    assert str(bogus) in envelope["error"]["message"]


def test_cli_extract_dispatches_pdf(minimal_pdf: Path) -> None:
    """The CLI's ``extract`` subcommand must dispatch .pdf to the PDF wrapper."""
    from conftest import run_cli  # type: ignore[import-not-found]

    result = run_cli("extract", str(minimal_pdf))

    assert result.returncode == 0, (
        f"extract must exit 0; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert payload["format"] == "pdf"
    assert payload["title"] == "Sidecar Fixture"
    assert payload["page_count"] == 1