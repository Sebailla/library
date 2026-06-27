"""Tests for ``alejandria_sidecar.extractors.video``.

Contract:

* Video fixtures return a schema_version=1 envelope with
  ``format: "video"`` and ``extractor_name: "video"``.
* Missing files return a ``FILE_UNREADABLE`` envelope.
* The CLI's ``extract`` subcommand dispatches each video extension
  to the video wrapper.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest


def test_extract_video_returns_envelope(minimal_video: Path) -> None:
    from alejandria_sidecar.extractors.video import extract_video

    envelope = extract_video(minimal_video)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "video"
    assert envelope["path"] == str(minimal_video.resolve())
    assert envelope["extractor_name"] == "video"


def test_extract_video_missing_file(tmp_path: Path) -> None:
    from alejandria_sidecar.extractors.video import extract_video

    bogus = tmp_path / "nope.mp4"
    envelope = extract_video(bogus)
    assert envelope["schema_version"] == 1
    assert envelope["error"]["code"] == "FILE_UNREADABLE"


@pytest.mark.parametrize("ext", [".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"])
def test_cli_extract_dispatches_video_extensions(
    tmp_path: Path, ext: str
) -> None:
    """Every video extension the sidecar advertises must reach the video wrapper."""
    from .conftest import run_cli  # type: ignore[import-not-found]

    fixture = tmp_path / f"fixture{ext}"
    # Smallest valid MP4 box. The MVP fallback path tolerates any
    # binary body when ffprobe is missing, which is the case in CI.
    fixture.write_bytes(b"\x00\x00\x00\x14ftypisom\x00\x00\x00\x00isomavc1")

    result = run_cli("extract", str(fixture))
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert payload["format"] == "video"
    assert payload["extractor_name"] == "video"