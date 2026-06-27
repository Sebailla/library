"""Tests for ``alejandria_sidecar.extractors.audio``.

Contract:

* Audio fixtures return a schema_version=1 envelope with
  ``format: "audio"`` and ``extractor_name: "audio"``.
* Missing files return a ``FILE_UNREADABLE`` envelope.
* The CLI's ``extract`` subcommand dispatches audio extensions to the
  audio wrapper.
* When ``mutagen`` is not importable (CI/dev without optional deps),
  the wrapper must still return a schema_version=1 envelope with a
  warning, not raise.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest


def test_extract_audio_returns_envelope(minimal_audio: Path) -> None:
    from alejandria_sidecar.extractors.audio import extract_audio

    envelope = extract_audio(minimal_audio)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "audio"
    assert envelope["path"] == str(minimal_audio.resolve())
    assert envelope["extractor_name"] == "audio"


def test_extract_audio_missing_file(tmp_path: Path) -> None:
    from alejandria_sidecar.extractors.audio import extract_audio

    bogus = tmp_path / "nope.mp3"
    envelope = extract_audio(bogus)
    assert envelope["schema_version"] == 1
    assert envelope["error"]["code"] == "FILE_UNREADABLE"


@pytest.mark.parametrize("ext", [".mp3", ".m4a", ".flac", ".ogg", ".wav", ".aac"])
def test_cli_extract_dispatches_audio_extensions(
    tmp_path: Path, ext: str
) -> None:
    """Every audio extension the sidecar advertises must reach the audio wrapper."""
    from .conftest import run_cli  # type: ignore[import-not-found]

    fixture = tmp_path / f"fixture{ext}"
    fixture.write_bytes(b"\x00\x00\x00\x00")  # any body works; MVP tolerates empty files

    result = run_cli("extract", str(fixture))
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert payload["format"] == "audio"
    assert payload["extractor_name"] == "audio"


def test_extract_audio_without_mutagen_returns_warning(
    minimal_audio: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When mutagen is unavailable, the wrapper degrades gracefully with a warning."""
    # Block the lazy import inside the audio extractor. We patch the
    # helper rather than sys.modules because the MVP uses a private
    # ``_load_mutagen`` that caches the import result.
    from alejandria.extractors import audio as mvp_audio

    monkeypatch.setattr(mvp_audio, "_MUTAGEN_IMPORT_ERROR", "mutagen not installed")
    monkeypatch.setattr(
        mvp_audio, "_load_mutagen", lambda: None, raising=False
    )

    from alejandria_sidecar.extractors.audio import extract_audio

    envelope = extract_audio(minimal_audio)
    assert envelope["schema_version"] == 1
    assert envelope["format"] == "audio"
    # The MVP audio extractor should have logged at least one warning
    # about mutagen being missing.
    assert any("mutagen" in w for w in envelope["warnings"])