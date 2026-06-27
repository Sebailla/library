"""Tests for ``alejandria_sidecar.extractors.image``.

The image wrapper is the entry point used by the sidecar CLI to convert
an :class:`ExtractedMetadata` (from the MVP ``alejandria.extractors.image``
module) into a JSON-friendly dict the CLI emits on stdout.

These tests drive the wrapper through its public function
:func:`extract_image` and assert the contract the spec promises:

* JSON envelope carries ``schema_version: 1``.
* The wrapped payload contains ``format: "image"``, the populated
  ``title`` / ``author`` fields when the fixture's metadata is
  available, and the ``extractor_name`` mirror.
* A missing file produces an error envelope with
  ``code: "FILE_UNREADABLE"`` (mapped to exit code 5).
* A corrupt (non-image) file does not crash the wrapper — the MVP
  extractor converts the decode failure into a non-empty ``warnings``
  list while still returning a well-formed envelope.
"""
from __future__ import annotations

import json
from pathlib import Path


def test_extract_image_returns_envelope_for_real_fixture(minimal_png: Path) -> None:
    """Happy path: a minimal valid PNG must yield format + extractor_name + title fallback."""
    from alejandria_sidecar.extractors.image import extract_image

    envelope = extract_image(minimal_png)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "image"
    assert envelope["path"] == str(minimal_png.resolve())
    # The MVP image extractor falls back to the filename stem when
    # Spotlight is not available (the CI sandbox has no `mdls`).
    assert envelope["title"] == minimal_png.stem
    # author is optional — Spotlight-only metadata, so we don't pin a
    # value, only that the key exists and is None or a string.
    assert envelope["author"] is None or isinstance(envelope["author"], str)
    # The wrapper always declares which extractor produced the envelope.
    assert envelope["extractor_name"] == "image"
    # Warnings must always be a list (possibly empty for a clean decode).
    assert isinstance(envelope["warnings"], list)


def test_extract_image_missing_file_returns_file_unreadable(tmp_path: Path) -> None:
    """Missing files must surface as a FILE_UNREADABLE error envelope."""
    from alejandria_sidecar.extractors.image import extract_image

    bogus = tmp_path / "nope.png"
    envelope = extract_image(bogus)

    assert envelope["schema_version"] == 1
    assert "error" in envelope
    assert envelope["error"]["code"] == "FILE_UNREADABLE"
    assert str(bogus) in envelope["error"]["message"]


def test_extract_image_corrupt_file_surfaces_warning(tmp_path: Path) -> None:
    """Corrupt (non-image) files must NOT crash the wrapper.

    The MVP :class:`ImageExtractor` catches Pillow decode failures and
    records them as warnings, so the wrapper still returns a
    well-formed envelope. This pins that contract: callers can rely on
    a dict, not on an exception, even for garbage input.
    """
    from alejandria_sidecar.extractors.image import extract_image

    corrupt = tmp_path / "broken.png"
    # Bytes that look like a filename but are not a decodable image.
    corrupt.write_bytes(b"this is not a valid image file at all")

    envelope = extract_image(corrupt)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "image"
    assert envelope["path"] == str(corrupt.resolve())
    # The MVP catches the decode failure and emits a warning — the
    # wrapper must propagate it, not swallow it silently.
    assert isinstance(envelope["warnings"], list)
    assert len(envelope["warnings"]) > 0, (
        f"expected at least one decode warning, got: {envelope['warnings']!r}"
    )


def test_cli_extract_dispatches_png(minimal_png: Path) -> None:
    """The CLI's ``extract`` subcommand must dispatch ``.png`` to the image wrapper."""
    from .conftest import run_cli

    result = run_cli("extract", str(minimal_png))

    assert result.returncode == 0, (
        f"extract must exit 0; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert payload["format"] == "image"
    assert payload["extractor_name"] == "image"