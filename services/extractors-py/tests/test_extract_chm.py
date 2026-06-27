"""Tests for ``alejandria_sidecar.extractors.chm``.

Contract:

* CHM fixtures return a schema_version=1 envelope with
  ``format: "chm"`` and ``extractor_name: "chm"``. The fallback title
  regex in the MVP extractor finds the title we seeded in the
  fixture body.
* Missing files return a ``FILE_UNREADABLE`` envelope.
* The CLI's ``extract`` subcommand dispatches ``.chm`` to the CHM wrapper.
"""
from __future__ import annotations

import json
from pathlib import Path


def test_extract_chm_returns_envelope(minimal_chm: Path) -> None:
    from alejandria_sidecar.extractors.chm import extract_chm

    envelope = extract_chm(minimal_chm)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "chm"
    assert envelope["path"] == str(minimal_chm.resolve())
    assert envelope["extractor_name"] == "chm"
    # The MVP CHM fallback path scans the first 256 KB for <title>...</title>;
    # the fixture seeds one so the wrapper can return a meaningful title.
    assert envelope["title"] == "Sidecar CHM Fixture"


def test_extract_chm_missing_file(tmp_path: Path) -> None:
    from alejandria_sidecar.extractors.chm import extract_chm

    bogus = tmp_path / "nope.chm"
    envelope = extract_chm(bogus)
    assert envelope["schema_version"] == 1
    assert envelope["error"]["code"] == "FILE_UNREADABLE"


def test_cli_extract_dispatches_chm(minimal_chm: Path) -> None:
    from .conftest import run_cli  # type: ignore[import-not-found]

    result = run_cli("extract", str(minimal_chm))
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert payload["format"] == "chm"
    assert payload["extractor_name"] == "chm"
    assert payload["title"] == "Sidecar CHM Fixture"