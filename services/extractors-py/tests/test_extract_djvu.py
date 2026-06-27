"""Tests for ``alejandria_sidecar.extractors.djvu``.

The DjVu wrapper is the entry point used by the sidecar CLI to convert
an :class:`ExtractedMetadata` (from the MVP ``alejandria.extractors.djvu``
module) into a JSON-friendly dict the CLI emits on stdout.

These tests drive the wrapper through its public function
:func:`extract_djvu` and assert the contract the spec promises:

* JSON envelope carries ``schema_version: 1``.
* The wrapped payload contains ``format: "djvu"``, the title fallback
  to the filename stem, the optional ``extracted_text`` field, and
  the ``extractor_name`` mirror.
* A missing file produces an error envelope with
  ``code: "FILE_UNREADABLE"`` (mapped to exit code 5).
* A corrupt (non-DjVu) file does not crash the wrapper — the MVP
  extractor converts the parse failure into a non-empty ``warnings``
  list while still returning a well-formed envelope.
* When the optional ``djvulibre`` binaries are not on ``$PATH`` the
  wrapper must still return a well-formed envelope with an explanatory
  warning — never an error.
* Both ``.djvu`` and ``.djv`` extensions route to the same wrapper
  via the dispatcher.
"""
from __future__ import annotations

import json
from pathlib import Path


def test_extract_djvu_returns_envelope_for_real_fixture(minimal_djvu: Path) -> None:
    """Happy path: a minimal valid DjVu must yield format + extractor_name + title fallback."""
    from alejandria_sidecar.extractors.djvu import extract_djvu

    envelope = extract_djvu(minimal_djvu)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "djvu"
    assert envelope["path"] == str(minimal_djvu.resolve())
    # The MVP DjVu extractor falls back to the filename stem when
    # djvulibre is not available (the CI sandbox has no binaries).
    assert envelope["title"] == minimal_djvu.stem
    # extracted_text is optional; the fixture is just a stub so
    # djvutxt can't extract anything. Accept None or a string.
    assert envelope["extracted_text"] is None or isinstance(
        envelope["extracted_text"], str
    )
    # The wrapper always declares which extractor produced the envelope.
    assert envelope["extractor_name"] == "djvu"
    # Warnings must always be a list.
    assert isinstance(envelope["warnings"], list)


def test_extract_djvu_missing_file_returns_file_unreadable(tmp_path: Path) -> None:
    """Missing files must surface as a FILE_UNREADABLE error envelope."""
    from alejandria_sidecar.extractors.djvu import extract_djvu

    bogus = tmp_path / "nope.djvu"
    envelope = extract_djvu(bogus)

    assert envelope["schema_version"] == 1
    assert "error" in envelope
    assert envelope["error"]["code"] == "FILE_UNREADABLE"
    assert str(bogus) in envelope["error"]["message"]


def test_extract_djvu_corrupt_file_surfaces_warning(tmp_path: Path) -> None:
    """Corrupt (non-DjVu) files must NOT crash the wrapper.

    The MVP :class:`DjvuExtractor` only reads filesystem metadata when
    djvulibre is missing, so even garbage input yields a well-formed
    envelope. This pins that contract: callers can rely on a dict, not
    on an exception, even for garbage input.
    """
    from alejandria_sidecar.extractors.djvu import extract_djvu

    corrupt = tmp_path / "broken.djvu"
    corrupt.write_bytes(b"this is not a valid djvu file at all")

    envelope = extract_djvu(corrupt)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "djvu"
    assert envelope["path"] == str(corrupt.resolve())
    # The MVP falls back to filename stem when no body text can be
    # extracted — wrapper must propagate it.
    assert envelope["title"] == corrupt.stem
    # The MVP always emits an "install djvulibre" warning when the
    # binaries are missing. The wrapper must propagate it.
    assert isinstance(envelope["warnings"], list)
    assert len(envelope["warnings"]) > 0, (
        f"expected at least one warning, got: {envelope['warnings']!r}"
    )


def test_extract_djvu_missing_djvulibre_surfaces_warning(minimal_djvu: Path) -> None:
    """When ``djvulibre`` is not on ``$PATH`` the wrapper must still return an envelope.

    Pins the graceful-degradation contract documented in
    ``alejandria/extractors/djvu.py``: the extractor records an
    explanatory warning and falls back to the filename stem as the
    title, rather than raising or returning an error envelope.
    """
    from alejandria_sidecar.extractors.djvu import extract_djvu

    envelope = extract_djvu(minimal_djvu)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "djvu"
    assert envelope["extractor_name"] == "djvu"
    # Title still falls back to the filename stem — the contract holds
    # even with no body-text backend available.
    assert envelope["title"] == minimal_djvu.stem
    # extracted_text must be None when no body text can be parsed.
    assert envelope["extracted_text"] is None
    # Warnings must include the "install djvulibre" hint so callers
    # can distinguish "no text because file is empty" from "no text
    # because the backend is unavailable".
    assert isinstance(envelope["warnings"], list)
    assert any("djvulibre" in w.lower() for w in envelope["warnings"]), (
        f"expected a djvulibre-missing warning, got: {envelope['warnings']!r}"
    )


def test_cli_extract_dispatches_djvu(minimal_djvu: Path) -> None:
    """The CLI's ``extract`` subcommand must dispatch ``.djvu`` to the DjVu wrapper."""
    from .conftest import run_cli

    result = run_cli("extract", str(minimal_djvu))

    assert result.returncode == 0, (
        f"extract must exit 0; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert payload["format"] == "djvu"
    assert payload["extractor_name"] == "djvu"


def test_cli_extract_dispatches_djv(tmp_path: Path) -> None:
    """The CLI's ``extract`` subcommand must also dispatch ``.djv`` (alias for DjVu)."""
    from .conftest import run_cli

    stub = tmp_path / "fixture.djv"
    # Same minimal magic as .djvu fixture — the wrapper doesn't read
    # the body anyway when djvulibre is missing.
    stub.write_bytes(b"AT&TFORM\x00\x00\x00\x14DJVMDIRM\x00\x00\x00\x00")

    result = run_cli("extract", str(stub))

    assert result.returncode == 0, (
        f"extract must exit 0; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    # .djv must route to the DjVu wrapper, not the UNKNOWN_FORMAT fallback.
    assert payload["format"] == "djvu", (
        f".djv must route to the DjVu wrapper; got format={payload['format']!r}"
    )
    assert payload["extractor_name"] == "djvu"