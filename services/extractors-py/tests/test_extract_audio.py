"""Tests for ``alejandria_sidecar.extractors.audio``.

The audio wrapper is the entry point used by the sidecar CLI to convert
an :class:`ExtractedMetadata` (from the MVP ``alejandria.extractors.audio``
module) into a JSON-friendly dict the CLI emits on stdout.

These tests drive the wrapper through its public function
:func:`extract_audio` and assert the contract the spec promises:

* JSON envelope carries ``schema_version: 1``.
* The wrapped payload contains ``format: "audio"``, the title fallback
  to the filename stem, the optional ``duration_seconds`` field, and
  the ``extractor_name`` mirror.
* A missing file produces an error envelope with
  ``code: "FILE_UNREADABLE"`` (mapped to exit code 5).
* A corrupt (non-audio) file does not crash the wrapper — the MVP
  extractor converts the decode failure into a non-empty ``warnings``
  list while still returning a well-formed envelope.
* When ``mutagen`` is not importable the wrapper must still return a
  well-formed envelope with an explanatory warning — never an error.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def test_extract_audio_returns_envelope_for_real_fixture(minimal_audio: Path) -> None:
    """Happy path: a minimal valid WAV must yield format + extractor_name + title fallback."""
    from alejandria_sidecar.extractors.audio import extract_audio

    envelope = extract_audio(minimal_audio)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "audio"
    assert envelope["path"] == str(minimal_audio.resolve())
    # The MVP audio extractor falls back to the filename stem when no
    # ID3 / Vorbis tags are present (the fixture is silent WAV bytes).
    assert envelope["title"] == minimal_audio.stem
    # duration_seconds is optional; the fixture is a real WAV so it
    # should be parseable to a non-negative float (or None if mutagen
    # can't read it — we accept either, but never raise).
    assert envelope["duration_seconds"] is None or isinstance(
        envelope["duration_seconds"], (int, float)
    )
    # The wrapper always declares which extractor produced the envelope.
    assert envelope["extractor_name"] == "audio"
    # Warnings must always be a list.
    assert isinstance(envelope["warnings"], list)


def test_extract_audio_missing_file_returns_file_unreadable(tmp_path: Path) -> None:
    """Missing files must surface as a FILE_UNREADABLE error envelope."""
    from alejandria_sidecar.extractors.audio import extract_audio

    bogus = tmp_path / "nope.mp3"
    envelope = extract_audio(bogus)

    assert envelope["schema_version"] == 1
    assert "error" in envelope
    assert envelope["error"]["code"] == "FILE_UNREADABLE"
    assert str(bogus) in envelope["error"]["message"]


def test_extract_audio_corrupt_file_surfaces_warning(tmp_path: Path) -> None:
    """Corrupt (non-audio) files must NOT crash the wrapper.

    The MVP :class:`AudioExtractor` catches ``mutagen.File`` failures
    and records them as warnings, so the wrapper still returns a
    well-formed envelope. This pins that contract: callers can rely on
    a dict, not on an exception, even for garbage input.
    """
    from alejandria_sidecar.extractors.audio import extract_audio

    corrupt = tmp_path / "broken.mp3"
    corrupt.write_bytes(b"this is not a valid audio file at all")

    envelope = extract_audio(corrupt)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "audio"
    assert envelope["path"] == str(corrupt.resolve())
    # The MVP catches the decode failure and emits a warning — the
    # wrapper must propagate it, not swallow it silently.
    assert isinstance(envelope["warnings"], list)
    assert len(envelope["warnings"]) > 0, (
        f"expected at least one decode warning, got: {envelope['warnings']!r}"
    )


def test_extract_audio_missing_mutagen_surfaces_warning(
    minimal_audio: Path, monkeypatch: "pytest.MonkeyPatch"
) -> None:
    """When ``mutagen`` is not importable the wrapper must still return a well-formed envelope.

    Pins the graceful-degradation contract documented in
    ``alejandria/extractors/audio.py``: the extractor (and therefore
    the wrapper) records an explanatory warning and returns the
    filename stem as the title, rather than raising or returning an
    error envelope.
    """
    from alejandria_sidecar.extractors.audio import extract_audio

    # Force the MVP audio module's lazy-loader to behave as if mutagen
    # is missing. We patch ``alejandria.extractors.audio._load_mutagen``
    # because that's the function the wrapper calls indirectly through
    # ``AudioExtractor().extract``.
    import alejandria.extractors.audio as mvp_audio

    monkeypatch.setattr(mvp_audio, "_load_mutagen", lambda: None)

    envelope = extract_audio(minimal_audio)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "audio"
    assert envelope["extractor_name"] == "audio"
    # Title still falls back to the filename stem — the contract holds
    # even with no metadata backend available.
    assert envelope["title"] == minimal_audio.stem
    # duration_seconds is None when mutagen can't tell us the length.
    assert envelope["duration_seconds"] is None
    # Warnings must include the mutagen-missing hint so callers can
    # distinguish "no tags because file is silent" from "no tags
    # because the backend is unavailable".
    assert isinstance(envelope["warnings"], list)
    assert any("mutagen" in w.lower() for w in envelope["warnings"]), (
        f"expected a mutagen-missing warning, got: {envelope['warnings']!r}"
    )


def test_cli_extract_dispatches_wav(minimal_audio: Path) -> None:
    """The CLI's ``extract`` subcommand must dispatch ``.wav`` to the audio wrapper."""
    from .conftest import run_cli

    result = run_cli("extract", str(minimal_audio))

    assert result.returncode == 0, (
        f"extract must exit 0; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert payload["format"] == "audio"
    assert payload["extractor_name"] == "audio"


def test_extract_audio_surfaces_id3_tags_when_present(minimal_audio_with_tags: Path) -> None:
    """A tagged WAV must surface title/author/duration from ID3 frames.

    Pins the contract that the wrapper does NOT silently fall back to
    the filename stem when mutagen successfully reads tags. This is
    the difference between "we know nothing about this file" and "we
    know exactly what the user labelled it".
    """
    from alejandria_sidecar.extractors.audio import extract_audio

    envelope = extract_audio(minimal_audio_with_tags)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "audio"
    assert envelope["extractor_name"] == "audio"
    # mutagen pulled the TIT2 frame — the wrapper must propagate it,
    # not replace it with the filename stem.
    assert envelope["title"] == "Sidecar Audio Fixture"
    assert envelope["author"] == "Sidecar Test Suite"
    # A real audio frame gives mutagen a positive duration.
    assert isinstance(envelope["duration_seconds"], (int, float))
    assert envelope["duration_seconds"] > 0