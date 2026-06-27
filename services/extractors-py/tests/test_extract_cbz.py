"""Tests for ``alejandria_sidecar.extractors.cbz``.

Contract:

* CBZ fixtures return a schema_version=1 envelope with
  ``format: "cbz"`` and ``extractor_name: "cbz"``.
* Missing files return a ``FILE_UNREADABLE`` envelope.
* The CLI's ``extract`` subcommand dispatches ``.cbz`` to the CBZ wrapper.
"""
from __future__ import annotations

import json
from pathlib import Path


def test_extract_cbz_returns_envelope(minimal_cbz: Path) -> None:
    from alejandria_sidecar.extractors.cbz import extract_cbz

    envelope = extract_cbz(minimal_cbz)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "cbz"
    assert envelope["path"] == str(minimal_cbz.resolve())
    assert envelope["extractor_name"] == "cbz"


def test_extract_cbz_missing_file(tmp_path: Path) -> None:
    from alejandria_sidecar.extractors.cbz import extract_cbz

    bogus = tmp_path / "nope.cbz"
    envelope = extract_cbz(bogus)
    assert envelope["schema_version"] == 1
    assert envelope["error"]["code"] == "FILE_UNREADABLE"


def test_cli_extract_dispatches_cbz(minimal_cbz: Path) -> None:
    from .conftest import run_cli  # type: ignore[import-not-found]

    result = run_cli("extract", str(minimal_cbz))
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert payload["format"] == "cbz"
    assert payload["extractor_name"] == "cbz"