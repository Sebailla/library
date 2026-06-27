"""Tests for ``alejandria_sidecar.extractors.image``.

Contract:

* Image fixtures return a schema_version=1 envelope with
  ``format: "image"``, ``extractor_name: "image"``.
* Missing files return a ``FILE_UNREADABLE`` envelope.
* The CLI's ``extract`` subcommand dispatches every supported image
  extension to the image wrapper.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest


@pytest.mark.parametrize(
    "ext",
    [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"],
)
def test_extract_image_dispatch_per_extension(
    tmp_path: Path, ext: str
) -> None:
    """Each image extension the sidecar advertises must reach the image wrapper."""
    from PIL import Image

    fixture = tmp_path / f"fixture{ext}"
    # WebP / GIF / BMP all accept RGB mode, so the same construction works.
    Image.new("RGB", (8, 8), color=(128, 128, 128)).save(fixture)

    from .conftest import run_cli  # type: ignore[import-not-found]

    result = run_cli("extract", str(fixture))
    assert result.returncode == 0, (
        f"extract on {ext} must exit 0; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert payload["format"] == "image"
    assert payload["extractor_name"] == "image"


def test_extract_image_returns_envelope(minimal_png: Path) -> None:
    from alejandria_sidecar.extractors.image import extract_image

    envelope = extract_image(minimal_png)

    assert envelope["schema_version"] == 1
    assert envelope["format"] == "image"
    assert envelope["path"] == str(minimal_png.resolve())
    assert envelope["extractor_name"] == "image"


def test_extract_image_missing_file(tmp_path: Path) -> None:
    from alejandria_sidecar.extractors.image import extract_image

    bogus = tmp_path / "nope.png"
    envelope = extract_image(bogus)
    assert envelope["schema_version"] == 1
    assert envelope["error"]["code"] == "FILE_UNREADABLE"