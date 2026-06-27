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

import pytest


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


# ---------------------------------------------------------------------------
# Comprehensive parametrized dispatch contract matrix
# ---------------------------------------------------------------------------
#
# The individual ``test_cli_extract_routes_*`` tests above pin the
# routing contract one extension at a time so a regression on a
# single format produces a precise failure message. The parametrized
# matrix below is the *at-a-glance* view: it makes "the dispatcher
# routes every supported extension correctly" a single pytest
# invocation rather than 12 separate reads. If you add a new wrapper,
# add a row to :data:`EXTENSION_DISPATCH_MATRIX` and a matching
# fixture in ``conftest.py`` — pytest will pick up the new case
# automatically.
#
# Note: the sidecar dispatches on the file's *suffix*, not on the
# wrapper's fixture filename. To exercise every row we copy each
# fixture to a path with the canonical extension before invoking
# the CLI.

# (extension, fixture_name, expected envelope ``format`` field,
# expected envelope ``extractor_name`` field)
EXTENSION_DISPATCH_MATRIX: list[tuple[str, str, str, str]] = [
    (".pdf", "minimal_pdf", "pdf", "pdf"),
    (".epub", "minimal_epub", "epub", "epub"),
    (".docx", "minimal_docx", "docx", "docx"),
    (".png", "minimal_png", "image", "image"),
    (".jpg", "minimal_jpeg", "image", "image"),
    (".cbz", "minimal_cbz", "cbz", "cbz"),
    (".mp3", "minimal_audio", "audio", "audio"),
    (".wav", "minimal_audio", "audio", "audio"),
    (".mp4", "minimal_video", "video", "video"),
    (".chm", "minimal_chm", "chm", "chm"),
    (".djvu", "minimal_djvu", "djvu", "djvu"),
    (".djv", "minimal_djvu", "djvu", "djvu"),
]


@pytest.mark.parametrize(
    ("extension", "fixture_name", "expected_format", "expected_extractor"),
    EXTENSION_DISPATCH_MATRIX,
    ids=[row[0] for row in EXTENSION_DISPATCH_MATRIX],
)
def test_dispatch_contract_matrix(
    extension: str,
    fixture_name: str,
    expected_format: str,
    expected_extractor: str,
    request: pytest.FixtureRequest,
) -> None:
    """The CLI must route every supported extension to the right wrapper.

    This is the at-a-glance contract test for "the dispatcher knows
    how to extract every format we ship". A failure here points at
    the specific extension, the expected wrapper, and the actual
    routing — enough to triage in one read.
    """
    from .conftest import run_cli

    fixture_path: Path = request.getfixturevalue(fixture_name)

    # Copy the fixture to a path with the canonical extension so the
    # dispatcher's suffix-based routing picks up the row under test.
    # The wrapper only inspects the suffix, not the file contents,
    # so the copy can share bytes with the original fixture.
    fixture_for_dispatch = fixture_path.with_suffix(extension)
    fixture_for_dispatch.write_bytes(fixture_path.read_bytes())

    # Audio is conditionally skipped when the wrapper is not
    # importable in the test environment — the MVP gracefully falls
    # back when ``mutagen`` is missing; see
    # ``dispatch._register_default_extractors``.
    if expected_extractor == "audio":
        import alejandria_sidecar.extractors.dispatch as dispatch_module

        # Trigger lazy registry build so the mapping reflects what's
        # actually importable here.
        dispatch_module.dispatch_extract(fixture_for_dispatch)
        if extension.lstrip(".") not in {
            ext.lstrip(".") for ext in dispatch_module._EXTRACTORS
        }:
            pytest.skip(f"audio wrapper not importable; skipping {extension}")

    result = run_cli("extract", str(fixture_for_dispatch))

    assert result.returncode == 0, (
        f"extract must exit 0 for extension {extension!r}; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1, (
        f"envelope must carry schema_version=1 for {extension!r}; got {payload!r}"
    )
    assert payload["format"] == expected_format, (
        f"{extension!r} must dispatch to format {expected_format!r}; "
        f"got {payload['format']!r}"
    )
    assert payload["extractor_name"] == expected_extractor, (
        f"{extension!r} must dispatch to extractor {expected_extractor!r}; "
        f"got {payload['extractor_name']!r}"
    )


def test_dispatch_matrix_covers_all_registered_wrappers() -> None:
    """The parametrized matrix must exercise every registered wrapper.

    Structural guard against silent regressions: the matrix pins the
    *wrapper* identity, not the extension enumeration (image/video
    families ship multiple extension aliases that all dispatch to the
    same wrapper). So we assert one row per distinct wrapper — if a
    new wrapper class is registered but the matrix doesn't list it,
    this test fails.

    The audio wrapper is conditionally checked: when ``mutagen`` is
    missing the wrapper is not registered and we skip the assertion.
    """
    from pathlib import Path as _Path

    from alejandria_sidecar.extractors.dispatch import dispatch_extract

    # Trigger lazy registry build.
    dispatch_extract(_Path("trigger.ext"))

    import alejandria_sidecar.extractors.dispatch as dispatch_module

    registered_exts = {ext.lower() for ext in dispatch_module._EXTRACTORS}
    matrix_exts = {row[0].lower() for row in EXTENSION_DISPATCH_MATRIX}

    # Build the set of distinct wrappers referenced by the registered
    # extensions: for each registered ext, look up the wrapper callable
    # and group by id() — extensions pointing at the same wrapper are
    # the same contract from the consumer's point of view.
    registered_wrappers = {id(ext): id(w) for ext, w in dispatch_module._EXTRACTORS.items()}
    matrix_wrappers = {
        id(dispatch_module._EXTRACTORS[ext])
        for ext in matrix_exts
        if ext in dispatch_module._EXTRACTORS
    }

    # The audio wrapper is optional and may not register in CI without
    # ``mutagen``. We only enforce the structural guard for it when it
    # is registered AND the matrix claims to exercise it.
    if ".mp3" in registered_exts and "audio" not in {
        row[3] for row in EXTENSION_DISPATCH_MATRIX
    }:
        pytest.fail(
            "audio wrapper is registered but EXTENSION_DISPATCH_MATRIX has no "
            "'audio' extractor row. Add a row using minimal_audio."
        )

    missing_wrappers = set(registered_wrappers.values()) - matrix_wrappers
    assert not missing_wrappers, (
        f"registered wrappers without a parametrized dispatch test: "
        f"{sorted(missing_wrappers)}. Add a row to EXTENSION_DISPATCH_MATRIX "
        f"in tests/test_cli_dispatch.py."
    )