"""Tests for ``alejandria_sidecar.extractors.dispatch``.

The dispatcher is the per-format router the CLI's ``extract`` subcommand
relies on. Each format extension maps to exactly one wrapper, and the
mapping is the single source of truth for "what does the sidecar know
how to extract".

These tests pin three contracts:

1. **Registry contents**: the registered wrappers for every supported
   extension are the actual ``extract_<fmt>`` functions from the
   per-format modules. Anything else is a silent routing bug.
2. **End-to-end routing**: the CLI subprocess invokes the right
   wrapper based on extension. We don't mock the dispatcher — we feed
   real fixtures and assert the wrapper-shaped envelope comes back.
3. **Unknown format fallback**: an unrecognised extension returns an
   ``UNKNOWN_FORMAT`` error envelope and the CLI exits with code 3
   (``EXIT_UNKNOWN_FORMAT``).
"""
from __future__ import annotations

import json
from pathlib import Path


def test_dispatch_registry_maps_epub_to_extract_epub() -> None:
    """``.epub`` must route to ``extractors.epub.extract_epub``."""
    from alejandria_sidecar.extractors import epub as epub_module
    from alejandria_sidecar.extractors.dispatch import dispatch_extract

    # Trigger lazy registry build by calling dispatch once with anything.
    dispatch_extract(Path("does-not-matter.epub"))

    # Reimport the dispatch module to peek at the populated registry.
    import alejandria_sidecar.extractors.dispatch as dispatch_module

    mapping = dispatch_module._EXTRACTORS
    assert ".epub" in mapping, "dispatcher registry is missing .epub"
    assert mapping[".epub"] is epub_module.extract_epub, (
        f".epub must route to extractors.epub.extract_epub; got {mapping['.epub']}"
    )


def test_dispatch_registry_maps_docx_to_extract_docx() -> None:
    """``.docx`` must route to ``extractors.docx.extract_docx``."""
    from alejandria_sidecar.extractors import docx as docx_module
    from alejandria_sidecar.extractors.dispatch import dispatch_extract

    dispatch_extract(Path("does-not-matter.docx"))

    import alejandria_sidecar.extractors.dispatch as dispatch_module

    mapping = dispatch_module._EXTRACTORS
    assert ".docx" in mapping, "dispatcher registry is missing .docx"
    assert mapping[".docx"] is docx_module.extract_docx, (
        f".docx must route to extractors.docx.extract_docx; got {mapping['.docx']}"
    )


def test_dispatch_registry_maps_png_to_extract_image() -> None:
    """``.png`` must route to ``extractors.image.extract_image``."""
    from alejandria_sidecar.extractors import image as image_module
    from alejandria_sidecar.extractors.dispatch import dispatch_extract

    dispatch_extract(Path("does-not-matter.png"))

    import alejandria_sidecar.extractors.dispatch as dispatch_module

    mapping = dispatch_module._EXTRACTORS
    assert ".png" in mapping, "dispatcher registry is missing .png"
    assert mapping[".png"] is image_module.extract_image, (
        f".png must route to extractors.image.extract_image; got {mapping['.png']}"
    )


def test_dispatch_registry_maps_cbz_to_extract_cbz() -> None:
    """``.cbz`` must route to ``extractors.cbz.extract_cbz``."""
    from alejandria_sidecar.extractors import cbz as cbz_module
    from alejandria_sidecar.extractors.dispatch import dispatch_extract

    dispatch_extract(Path("does-not-matter.cbz"))

    import alejandria_sidecar.extractors.dispatch as dispatch_module

    mapping = dispatch_module._EXTRACTORS
    assert ".cbz" in mapping, "dispatcher registry is missing .cbz"
    assert mapping[".cbz"] is cbz_module.extract_cbz, (
        f".cbz must route to extractors.cbz.extract_cbz; got {mapping['.cbz']}"
    )


def test_dispatch_registry_maps_mp3_to_extract_audio() -> None:
    """``.mp3`` must route to ``extractors.audio.extract_audio`` when the wrapper is available."""
    from alejandria_sidecar.extractors import audio as audio_module
    from alejandria_sidecar.extractors.dispatch import dispatch_extract

    dispatch_extract(Path("does-not-matter.mp3"))

    import alejandria_sidecar.extractors.dispatch as dispatch_module

    mapping = dispatch_module._EXTRACTORS
    # The audio wrapper is registered lazily and only when its import
    # succeeds — see ``dispatch._register_default_extractors`` for the
    # try/except guard. If the import failed the registry will simply
    # not contain the audio extensions.
    if ".mp3" not in mapping:
        import pytest

        pytest.skip("audio wrapper not importable in this environment")
    assert mapping[".mp3"] is audio_module.extract_audio, (
        f".mp3 must route to extractors.audio.extract_audio; got {mapping['.mp3']}"
    )


def test_dispatch_registry_maps_mp4_to_extract_video() -> None:
    """``.mp4`` must route to ``extractors.video.extract_video``."""
    from alejandria_sidecar.extractors import video as video_module
    from alejandria_sidecar.extractors.dispatch import dispatch_extract

    dispatch_extract(Path("does-not-matter.mp4"))

    import alejandria_sidecar.extractors.dispatch as dispatch_module

    mapping = dispatch_module._EXTRACTORS
    assert ".mp4" in mapping, "dispatcher registry is missing .mp4"
    assert mapping[".mp4"] is video_module.extract_video, (
        f".mp4 must route to extractors.video.extract_video; got {mapping['.mp4']}"
    )


def test_dispatch_registry_maps_avi_to_extract_video() -> None:
    """``.avi`` must route to ``extractors.video.extract_video`` (same wrapper as .mp4)."""
    from alejandria_sidecar.extractors import video as video_module
    from alejandria_sidecar.extractors.dispatch import dispatch_extract

    dispatch_extract(Path("does-not-matter.avi"))

    import alejandria_sidecar.extractors.dispatch as dispatch_module

    mapping = dispatch_module._EXTRACTORS
    assert ".avi" in mapping, "dispatcher registry is missing .avi"
    assert mapping[".avi"] is video_module.extract_video, (
        f".avi must route to extractors.video.extract_video; got {mapping['.avi']}"
    )


def test_dispatch_registry_maps_chm_to_extract_chm() -> None:
    """``.chm`` must route to ``extractors.chm.extract_chm``."""
    from alejandria_sidecar.extractors import chm as chm_module
    from alejandria_sidecar.extractors.dispatch import dispatch_extract

    dispatch_extract(Path("does-not-matter.chm"))

    import alejandria_sidecar.extractors.dispatch as dispatch_module

    mapping = dispatch_module._EXTRACTORS
    assert ".chm" in mapping, "dispatcher registry is missing .chm"
    assert mapping[".chm"] is chm_module.extract_chm, (
        f".chm must route to extractors.chm.extract_chm; got {mapping['.chm']}"
    )


def test_dispatch_registry_maps_djvu_to_extract_djvu() -> None:
    """``.djvu`` must route to ``extractors.djvu.extract_djvu``."""
    from alejandria_sidecar.extractors import djvu as djvu_module
    from alejandria_sidecar.extractors.dispatch import dispatch_extract

    dispatch_extract(Path("does-not-matter.djvu"))

    import alejandria_sidecar.extractors.dispatch as dispatch_module

    mapping = dispatch_module._EXTRACTORS
    assert ".djvu" in mapping, "dispatcher registry is missing .djvu"
    assert mapping[".djvu"] is djvu_module.extract_djvu, (
        f".djvu must route to extractors.djvu.extract_djvu; got {mapping['.djvu']}"
    )


def test_dispatch_registry_maps_djv_alias_to_extract_djvu() -> None:
    """``.djv`` must route to the same ``extractors.djvu.extract_djvu`` wrapper."""
    from alejandria_sidecar.extractors import djvu as djvu_module
    from alejandria_sidecar.extractors.dispatch import dispatch_extract

    dispatch_extract(Path("does-not-matter.djv"))

    import alejandria_sidecar.extractors.dispatch as dispatch_module

    mapping = dispatch_module._EXTRACTORS
    assert ".djv" in mapping, "dispatcher registry is missing .djv alias"
    assert mapping[".djv"] is djvu_module.extract_djvu, (
        f".djv must route to extractors.djvu.extract_djvu; got {mapping['.djv']}"
    )


def test_cli_extract_routes_epub_through_dispatcher(minimal_epub: Path) -> None:
    """End-to-end: a real EPUB fed to the CLI must surface the EPUB wrapper output."""
    from .conftest import run_cli

    result = run_cli("extract", str(minimal_epub))

    assert result.returncode == 0, (
        f"extract must exit 0 for a valid EPUB; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    # The EPUB wrapper's envelope shape, NOT the dispatcher's unknown-format
    # envelope. If the dispatcher misroutes this, the format key would be
    # 'unknown' or 'epub' would be missing entirely.
    assert payload["format"] == "epub"
    assert payload["extractor_name"] == "epub"
    assert payload["title"] == "Sidecar EPUB Fixture"


def test_cli_extract_routes_docx_through_dispatcher(minimal_docx: Path) -> None:
    """End-to-end: a real DOCX fed to the CLI must surface the DOCX wrapper output."""
    from .conftest import run_cli

    result = run_cli("extract", str(minimal_docx))

    assert result.returncode == 0, (
        f"extract must exit 0 for a valid DOCX; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["format"] == "docx"
    assert payload["extractor_name"] == "docx"
    assert payload["title"] == "Sidecar DOCX Fixture"


def test_cli_extract_routes_png_through_dispatcher(minimal_png: Path) -> None:
    """End-to-end: a real PNG fed to the CLI must surface the image wrapper output."""
    from .conftest import run_cli

    result = run_cli("extract", str(minimal_png))

    assert result.returncode == 0, (
        f"extract must exit 0 for a valid PNG; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["format"] == "image"
    assert payload["extractor_name"] == "image"


def test_cli_extract_routes_cbz_through_dispatcher(minimal_cbz: Path) -> None:
    """End-to-end: a real CBZ fed to the CLI must surface the CBZ wrapper output."""
    from .conftest import run_cli

    result = run_cli("extract", str(minimal_cbz))

    assert result.returncode == 0, (
        f"extract must exit 0 for a valid CBZ; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["format"] == "cbz"
    assert payload["extractor_name"] == "cbz"


def test_cli_extract_routes_wav_through_dispatcher(minimal_audio: Path) -> None:
    """End-to-end: a real WAV fed to the CLI must surface the audio wrapper output."""
    from .conftest import run_cli

    result = run_cli("extract", str(minimal_audio))

    assert result.returncode == 0, (
        f"extract must exit 0 for a valid WAV; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["format"] == "audio"
    assert payload["extractor_name"] == "audio"


def test_cli_extract_routes_mp4_through_dispatcher(minimal_video: Path) -> None:
    """End-to-end: a real MP4 fed to the CLI must surface the video wrapper output."""
    from .conftest import run_cli

    result = run_cli("extract", str(minimal_video))

    assert result.returncode == 0, (
        f"extract must exit 0 for a valid MP4; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["format"] == "video"
    assert payload["extractor_name"] == "video"


def test_cli_extract_routes_chm_through_dispatcher(minimal_chm: Path) -> None:
    """End-to-end: a real CHM fed to the CLI must surface the CHM wrapper output."""
    from .conftest import run_cli

    result = run_cli("extract", str(minimal_chm))

    assert result.returncode == 0, (
        f"extract must exit 0 for a valid CHM; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["format"] == "chm"
    assert payload["extractor_name"] == "chm"


def test_cli_extract_routes_djvu_through_dispatcher(minimal_djvu: Path) -> None:
    """End-to-end: a real DjVu fed to the CLI must surface the DjVu wrapper output."""
    from .conftest import run_cli

    result = run_cli("extract", str(minimal_djvu))

    assert result.returncode == 0, (
        f"extract must exit 0 for a valid DjVu; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["format"] == "djvu"
    assert payload["extractor_name"] == "djvu"


def test_cli_extract_unknown_format_returns_unknown_envelope(tmp_path: Path) -> None:
    """An extension the sidecar doesn't know must return UNKNOWN_FORMAT (exit 3)."""
    from .conftest import run_cli

    bogus = tmp_path / "mystery.xyz"
    bogus.write_bytes(b"placeholder")

    result = run_cli("extract", str(bogus))

    assert result.returncode == 3, (
        f"unknown format must exit 3 (EXIT_UNKNOWN_FORMAT); got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert "error" in payload
    assert payload["error"]["code"] == "UNKNOWN_FORMAT"