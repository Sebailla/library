"""Tests for ``alejandria_sidecar.extractors.djvu``.

Contract:

* DjVu fixtures return a schema_version=1 envelope with
  ``format: "djvu"`` and ``extractor_name: "djvu"``.
* Missing files return a ``FILE_UNREADABLE`` envelope.
* The CLI's ``extract`` subcommand dispatches ``.djvu`` and ``.djv``
  to the DjVu wrapper.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest


def test_extract_djvu_returns_envelope(minimal_djvu: Path) -> None:
    from alejandria_sidecar.extractors.djvu import extract_djvu

    envelope = extract_djvu(minimal_djvu)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "djvu"
    assert envelope["path"] == str(minimal_djvu.resolve())
    assert envelope["extractor_name"] == "djvu"


def test_extract_djvu_missing_file(tmp_path: Path) -> None:
    from alejandria_sidecar.extractors.djvu import extract_djvu

    bogus = tmp_path / "nope.djvu"
    envelope = extract_djvu(bogus)
    assert envelope["schema_version"] == 1
    assert envelope["error"]["code"] == "FILE_UNREADABLE"


@pytest.mark.parametrize("ext", [".djvu", ".djv"])
def test_cli_extract_dispatches_djvu_extensions(
    tmp_path: Path, ext: str
) -> None:
    """Both .djvu and .djv extensions must reach the DjVu wrapper."""
    from .conftest import run_cli  # type: ignore[import-not-found]

    fixture = tmp_path / f"fixture{ext}"
    fixture.write_bytes(b"AT&TFORM\x00\x00\x00\x14DJVMDIRM\x00\x00\x00\x00")

    result = run_cli("extract", str(fixture))
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert payload["format"] == "djvu"
    assert payload["extractor_name"] == "djvu"