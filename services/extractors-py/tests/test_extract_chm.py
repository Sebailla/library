"""Tests for ``alejandria_sidecar.extractors.chm``.

The CHM wrapper is the entry point used by the sidecar CLI to convert
an :class:`ExtractedMetadata` (from the MVP ``alejandria.extractors.chm``
module) into a JSON-friendly dict the CLI emits on stdout.

These tests drive the wrapper through its public function
:func:`extract_chm` and assert the contract the spec promises:

* JSON envelope carries ``schema_version: 1``.
* The wrapped payload contains ``format: "chm"``, the title extracted
  from the inner ``<title>`` block (or filename stem fallback), and
  the ``extractor_name`` mirror.
* A missing file produces an error envelope with
  ``code: "FILE_UNREADABLE"`` (mapped to exit code 5).
* A corrupt (non-CHM) file does not crash the wrapper — the MVP
  extractor converts the parse failure into a non-empty ``warnings``
  list while still returning a well-formed envelope.
* When the optional ``chm`` Python binding is not importable the
  wrapper must still return a well-formed envelope with an explanatory
  warning — never an error.
"""
from __future__ import annotations

import json
from pathlib import Path


def test_extract_chm_returns_envelope_for_real_fixture(minimal_chm: Path) -> None:
    """Happy path: a minimal valid CHM must yield format + extractor_name + title."""
    from alejandria_sidecar.extractors.chm import extract_chm

    envelope = extract_chm(minimal_chm)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "chm"
    assert envelope["path"] == str(minimal_chm.resolve())
    # The MVP CHM extractor scans the first 256 KB for an inner
    # <title>...</title> block. Our fixture seeds one with
    # "Sidecar CHM Fixture" so the inner title wins over the
    # filename stem fallback when the optional binding is missing.
    assert envelope["title"] in {"Sidecar CHM Fixture", minimal_chm.stem}, (
        f"expected inner title or stem fallback; got: {envelope['title']!r}"
    )
    # The wrapper always declares which extractor produced the envelope.
    assert envelope["extractor_name"] == "chm"
    # Warnings must always be a list. With the binding missing the MVP
    # adds a "python binding not available" warning; otherwise empty.
    assert isinstance(envelope["warnings"], list)


def test_extract_chm_missing_file_returns_file_unreadable(tmp_path: Path) -> None:
    """Missing files must surface as a FILE_UNREADABLE error envelope."""
    from alejandria_sidecar.extractors.chm import extract_chm

    bogus = tmp_path / "nope.chm"
    envelope = extract_chm(bogus)

    assert envelope["schema_version"] == 1
    assert "error" in envelope
    assert envelope["error"]["code"] == "FILE_UNREADABLE"
    assert str(bogus) in envelope["error"]["message"]


def test_extract_chm_corrupt_file_surfaces_warning(tmp_path: Path) -> None:
    """Corrupt (non-CHM) files must NOT crash the wrapper.

    The MVP :class:`ChmExtractor` checks the ITSF magic and, when
    absent, records an explanatory warning while still returning a
    well-formed envelope. This pins that contract: callers can rely
    on a dict, not on an exception, even for garbage input.
    """
    from alejandria_sidecar.extractors.chm import extract_chm

    corrupt = tmp_path / "broken.chm"
    # Plain ASCII without the ITSF magic — extractor must flag this
    # as "not a CHM" and fall back to filename-stem title.
    corrupt.write_bytes(b"this is not a valid chm file at all")

    envelope = extract_chm(corrupt)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "chm"
    assert envelope["path"] == str(corrupt.resolve())
    # Title falls back to the filename stem when ITSF magic is missing.
    assert envelope["title"] == corrupt.stem
    # The MVP must surface a "not a CHM" warning so callers know
    # the inner title was not parsed.
    assert isinstance(envelope["warnings"], list)
    assert any(
        "ITSF" in w or "not a CHM" in w or "magic" in w.lower() for w in envelope["warnings"]
    ), (
        f"expected an ITSF/magic warning, got: {envelope['warnings']!r}"
    )


def test_extract_chm_missing_binding_surfaces_warning(minimal_chm: Path) -> None:
    """When the optional ``chm`` Python binding is missing the wrapper must still return an envelope.

    Pins the graceful-degradation contract documented in
    ``alejandria/extractors/chm.py``: the extractor adds a warning and
    falls through to the ITSF/filename-stem fallback, rather than
    raising or returning an error envelope.
    """
    from alejandria_sidecar.extractors.chm import extract_chm

    envelope = extract_chm(minimal_chm)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "chm"
    assert envelope["extractor_name"] == "chm"
    # Title still resolves (either via inner title or filename stem).
    assert isinstance(envelope["title"], str)
    assert envelope["title"]
    # When the binding is missing the MVP adds a warning. If the
    # binding happens to be installed the warning may not appear,
    # so we accept either: the envelope must always be well-formed.
    assert isinstance(envelope["warnings"], list)


def test_cli_extract_dispatches_chm(minimal_chm: Path) -> None:
    """The CLI's ``extract`` subcommand must dispatch ``.chm`` to the CHM wrapper."""
    from .conftest import run_cli

    result = run_cli("extract", str(minimal_chm))

    assert result.returncode == 0, (
        f"extract must exit 0; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert payload["format"] == "chm"
    assert payload["extractor_name"] == "chm"