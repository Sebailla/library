"""Tests for ``alejandria_sidecar.extractors.video``.

The video wrapper is the entry point used by the sidecar CLI to convert
an :class:`ExtractedMetadata` (from the MVP ``alejandria.extractors.video``
module) into a JSON-friendly dict the CLI emits on stdout.

These tests drive the wrapper through its public function
:func:`extract_video` and assert the contract the spec promises:

* JSON envelope carries ``schema_version: 1``.
* The wrapped payload contains ``format: "video"``, the title fallback
  to the filename stem, the optional ``duration_seconds`` field, and
  the ``extractor_name`` mirror.
* A missing file produces an error envelope with
  ``code: "FILE_UNREADABLE"`` (mapped to exit code 5).
* A corrupt (non-video) file does not crash the wrapper — the MVP
  extractor converts the decode failure into a non-empty ``warnings``
  list while still returning a well-formed envelope.
* When ``ffprobe``/``ffmpeg`` are not on ``$PATH`` the wrapper must
  still return a well-formed envelope with an explanatory warning —
  never an error.
"""
from __future__ import annotations

import json
from pathlib import Path


def test_extract_video_returns_envelope_for_real_fixture(minimal_video: Path) -> None:
    """Happy path: a minimal valid MP4 must yield format + extractor_name + title fallback."""
    from alejandria_sidecar.extractors.video import extract_video

    envelope = extract_video(minimal_video)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "video"
    assert envelope["path"] == str(minimal_video.resolve())
    # The MVP video extractor falls back to the filename stem when
    # ffprobe/ffmpeg are not available (the CI sandbox has no binaries).
    assert envelope["title"] == minimal_video.stem
    # duration_seconds is optional; the fixture is not a real video so
    # ffprobe cannot decode it. The wrapper must still surface a value
    # (None if ffprobe is missing, otherwise whatever ffprobe returned).
    assert envelope["duration_seconds"] is None or isinstance(
        envelope["duration_seconds"], (int, float)
    )
    # The wrapper always declares which extractor produced the envelope.
    assert envelope["extractor_name"] == "video"
    # Warnings must always be a list.
    assert isinstance(envelope["warnings"], list)


def test_extract_video_missing_file_returns_file_unreadable(tmp_path: Path) -> None:
    """Missing files must surface as a FILE_UNREADABLE error envelope."""
    from alejandria_sidecar.extractors.video import extract_video

    bogus = tmp_path / "nope.mp4"
    envelope = extract_video(bogus)

    assert envelope["schema_version"] == 1
    assert "error" in envelope
    assert envelope["error"]["code"] == "FILE_UNREADABLE"
    assert str(bogus) in envelope["error"]["message"]


def test_extract_video_corrupt_file_surfaces_warning(tmp_path: Path) -> None:
    """Corrupt (non-video) files must NOT crash the wrapper.

    The MVP :class:`VideoExtractor` catches ffprobe/ffmpeg failures and
    records them as warnings, so the wrapper still returns a
    well-formed envelope. This pins that contract: callers can rely on
    a dict, not on an exception, even for garbage input.
    """
    from alejandria_sidecar.extractors.video import extract_video

    corrupt = tmp_path / "broken.mp4"
    corrupt.write_bytes(b"this is not a valid mp4 file at all")

    envelope = extract_video(corrupt)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "video"
    assert envelope["path"] == str(corrupt.resolve())
    # The MVP catches the decode failure and emits a warning — the
    # wrapper must propagate it, not swallow it silently. Warnings
    # may include "ffprobe not on PATH" / "ffmpeg not on PATH" /
    # "ffprobe returned no duration and no title" — we accept any of
    # these as evidence the wrapper surfaced the failure.
    assert isinstance(envelope["warnings"], list)
    assert len(envelope["warnings"]) > 0, (
        f"expected at least one decode warning, got: {envelope['warnings']!r}"
    )


def test_extract_video_missing_ffmpeg_surfaces_warning(
    minimal_video: Path,
) -> None:
    """When ``ffprobe``/``ffmpeg`` are not on ``$PATH`` the wrapper must still return an envelope.

    Pins the graceful-degradation contract documented in
    ``alejandria/extractors/video.py``: the extractor records an
    explanatory warning and falls back to the filename stem as the
    title, rather than raising or returning an error envelope.

    If the host machine happens to have ffprobe installed, this test
    simply exercises the "ffprobe ran but couldn't decode the stub"
    path. Either way the wrapper must not crash and must return a
    well-formed envelope.
    """
    from alejandria_sidecar.extractors.video import extract_video

    envelope = extract_video(minimal_video)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "video"
    assert envelope["extractor_name"] == "video"
    # Title still falls back to the filename stem — the contract holds
    # even with no metadata backend available.
    assert envelope["title"] == minimal_video.stem
    # Warnings always populated when ffmpeg/ffprobe can't fully decode
    # the stub fixture (whether by missing binary or by garbage input).
    assert isinstance(envelope["warnings"], list)
    assert len(envelope["warnings"]) > 0, (
        f"expected at least one ffmpeg/ffprobe warning, got: {envelope['warnings']!r}"
    )


def test_cli_extract_dispatches_mp4(minimal_video: Path) -> None:
    """The CLI's ``extract`` subcommand must dispatch ``.mp4`` to the video wrapper."""
    from .conftest import run_cli

    result = run_cli("extract", str(minimal_video))

    assert result.returncode == 0, (
        f"extract must exit 0; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert payload["format"] == "video"
    assert payload["extractor_name"] == "video"