"""Tests for ``alejandria_sidecar.extractors.cbz``.

The CBZ wrapper is the entry point used by the sidecar CLI to convert
an :class:`ExtractedMetadata` (from the MVP ``alejandria.extractors.cbz``
module) into a JSON-friendly dict the CLI emits on stdout.

These tests drive the wrapper through its public function
:func:`extract_cbz` and assert the contract the spec promises:

* JSON envelope carries ``schema_version: 1``.
* The wrapped payload contains ``format: "cbz"``, the title fallback
  to the filename stem, and the ``extractor_name`` mirror.
* A missing file produces an error envelope with
  ``code: "FILE_UNREADABLE"`` (mapped to exit code 5).
* A corrupt (non-ZIP) file does not crash the wrapper — the MVP
  extractor converts the parse failure into a non-empty ``warnings``
  list while still returning a well-formed envelope.
"""
from __future__ import annotations

import json
from pathlib import Path


def test_extract_cbz_returns_envelope_for_real_fixture(minimal_cbz: Path) -> None:
    """Happy path: a minimal valid CBZ must yield format + extractor_name + title fallback."""
    from alejandria_sidecar.extractors.cbz import extract_cbz

    envelope = extract_cbz(minimal_cbz)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "cbz"
    assert envelope["path"] == str(minimal_cbz.resolve())
    # The MVP CBZ extractor falls back to the filename stem when
    # Spotlight is not available (the CI sandbox has no `mdls`).
    assert envelope["title"] == minimal_cbz.stem
    # The wrapper always declares which extractor produced the envelope.
    assert envelope["extractor_name"] == "cbz"
    # Warnings must always be a list (possibly empty for a clean decode).
    assert isinstance(envelope["warnings"], list)


def test_extract_cbz_missing_file_returns_file_unreadable(tmp_path: Path) -> None:
    """Missing files must surface as a FILE_UNREADABLE error envelope."""
    from alejandria_sidecar.extractors.cbz import extract_cbz

    bogus = tmp_path / "nope.cbz"
    envelope = extract_cbz(bogus)

    assert envelope["schema_version"] == 1
    assert "error" in envelope
    assert envelope["error"]["code"] == "FILE_UNREADABLE"
    assert str(bogus) in envelope["error"]["message"]


def test_extract_cbz_corrupt_file_surfaces_warning(tmp_path: Path) -> None:
    """Corrupt (non-ZIP) files must NOT crash the wrapper.

    The MVP :class:`CbzExtractor` catches ZIP parse failures and
    records them as warnings, so the wrapper still returns a
    well-formed envelope. This pins that contract: callers can rely on
    a dict, not on an exception, even for garbage input.
    """
    from alejandria_sidecar.extractors.cbz import extract_cbz

    corrupt = tmp_path / "broken.cbz"
    corrupt.write_bytes(b"this is not a valid zip archive")

    envelope = extract_cbz(corrupt)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "cbz"
    assert envelope["path"] == str(corrupt.resolve())
    # The MVP catches the parse failure and emits a warning — the
    # wrapper must propagate it, not swallow it silently.
    assert isinstance(envelope["warnings"], list)
    assert any("not a valid zip" in w for w in envelope["warnings"]), (
        f"expected a 'not a valid zip' warning, got: {envelope['warnings']!r}"
    )


def test_cli_extract_dispatches_cbz(minimal_cbz: Path) -> None:
    """The CLI's ``extract`` subcommand must dispatch ``.cbz`` to the CBZ wrapper."""
    from .conftest import run_cli

    result = run_cli("extract", str(minimal_cbz))

    assert result.returncode == 0, (
        f"extract must exit 0; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert payload["format"] == "cbz"
    assert payload["extractor_name"] == "cbz"