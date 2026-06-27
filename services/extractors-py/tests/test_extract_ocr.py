"""Tests for ``alejandria_sidecar.extractors.ocr``.

Contract:

* OCR fixtures return a schema_version=1 envelope with
  ``text``, ``confidence``, ``backend``, and ``language`` fields.
* The CLI's ``ocr`` subcommand accepts ``--backend`` and ``--lang``
  flags.
* Missing files return a ``FILE_UNREADABLE`` envelope.
* When no backend is available, the CLI exits with code 4 (backend
  unavailable).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest


def test_cli_ocr_help_lists_backend_flag() -> None:
    """The ``ocr`` subcommand must advertise ``--backend`` and ``--lang``."""
    from .conftest import run_cli  # type: ignore[import-not-found]

    result = run_cli("ocr", "--help")
    assert result.returncode == 0
    assert "--backend" in result.stdout
    assert "--lang" in result.stdout


def test_cli_ocr_missing_file_returns_file_unreadable(tmp_path: Path) -> None:
    from .conftest import run_cli  # type: ignore[import-not-found]

    bogus = tmp_path / "nope.png"
    result = run_cli("ocr", str(bogus))
    assert result.returncode == 5, result.stderr
    payload = json.loads(result.stdout)
    assert payload["error"]["code"] == "FILE_UNREADABLE"


def test_cli_ocr_dispatch_contract(tmp_path: Path) -> None:
    """The ``ocr`` subcommand must always emit a well-formed JSON envelope.

    On a host without any OCR backend the envelope carries
    ``BACKEND_UNAVAILABLE`` and the CLI exits 4. On a host with
    Tesseract (or Vision) the envelope carries the recognised text +
    confidence and the CLI exits 0. The wrapper layer must NEVER raise.
    """
    from .conftest import run_cli  # type: ignore[import-not-found]

    from PIL import Image

    fixture = tmp_path / "fixture.png"
    Image.new("RGB", (8, 8), color=(255, 255, 255)).save(fixture)

    result = run_cli("ocr", str(fixture))
    payload = json.loads(result.stdout)

    assert payload["schema_version"] == 1

    if "error" in payload:
        # The wrapper caught an OCR backend failure (missing backend,
        # missing language data, corrupt image, etc.) and turned it
        # into an envelope. Exit code MUST be in the documented set
        # (4 for BACKEND_UNAVAILABLE; never 0 because we did not
        # actually recognise anything).
        assert result.returncode != 0
        assert payload["error"]["code"] in {
            "BACKEND_UNAVAILABLE",
            "OCR_FAILED",
        }
    else:
        # A real backend produced a result; the envelope must contain
        # text + backend + confidence per the spec.
        assert result.returncode == 0
        assert "text" in payload
        assert "backend" in payload
        assert "confidence" in payload


def test_extract_ocr_unit_returns_backend_unavailable_when_registry_empty(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The wrapper function itself must return BACKEND_UNAVAILABLE when no backend is registered."""
    from PIL import Image

    fixture = tmp_path / "fixture.png"
    Image.new("RGB", (8, 8), color=(255, 255, 255)).save(fixture)

    from alejandria.ocr import backend as mvp_ocr_backend

    monkeypatch.setattr(mvp_ocr_backend, "_BACKENDS", [])

    from alejandria_sidecar.extractors.ocr import extract_ocr

    envelope = extract_ocr(fixture)

    assert envelope["schema_version"] == 1
    assert envelope["error"]["code"] == "BACKEND_UNAVAILABLE"


def test_extract_ocr_unit_missing_file(tmp_path: Path) -> None:
    from alejandria_sidecar.extractors.ocr import extract_ocr

    bogus = tmp_path / "nope.png"
    envelope = extract_ocr(bogus)
    assert envelope["error"]["code"] == "FILE_UNREADABLE"