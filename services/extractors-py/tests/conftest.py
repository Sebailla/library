"""Shared pytest fixtures and helpers for the alejandria-sidecar test suite.

Goals
-----

* Provide small, valid sample files for every supported format so the
  per-format extractor wrappers can be exercised end-to-end without
  shipping real book assets in the repository.
* Make ``alejandria`` (the MVP package at ``../../../biblioteca``)
  importable from tests by extending :data:`sys.path` once.
* Expose a deterministic helper that invokes the CLI in a subprocess
  for integration tests, matching the pattern already used in
  ``test_cli_help.py``.

The MVP code under ``biblioteca/alejandria`` is read-only reference;
the sidecar lives in ``biblioteca-v2/services/extractors-py`` and
imports it via ``sys.path`` injection so it works without an editable
install.
"""
from __future__ import annotations

import io
import os
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# sys.path injection for the read-only MVP at ``../../..`` (biblioteca/)
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MVP_ROOT = PROJECT_ROOT.parents[2] / "biblioteca"
if str(MVP_ROOT) not in sys.path:
    sys.path.insert(0, str(MVP_ROOT))


# ---------------------------------------------------------------------------
# CLI subprocess helper (mirror of test_cli_help.py but exposed package-wide)
# ---------------------------------------------------------------------------


def run_cli(*args: str, timeout: int = 30) -> subprocess.CompletedProcess[str]:
    """Invoke the sidecar CLI in a subprocess from the project root.

    Tests get a textual ``CompletedProcess`` with captured stdout / stderr
    and a non-zero return code on failure. Timeouts surface as
    ``pytest.fail`` with a useful message.
    """
    proc = subprocess.run(
        [sys.executable, "-m", "alejandria_sidecar", *args],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        timeout=timeout,
        env={**os.environ, "PYTHONPATH": PROJECT_ROOT},
    )
    return proc


# ---------------------------------------------------------------------------
# Fixture generators — minimal valid files for every format family
# ---------------------------------------------------------------------------


@pytest.fixture()
def minimal_pdf(tmp_path: Path) -> Path:
    """Generate a 1-page PDF using PyMuPDF (already a runtime dep of the MVP)."""
    import pymupdf  # local import keeps top-of-file import cost minimal

    out = tmp_path / "fixture.pdf"
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text(
        (72, 72),
        "Sidecar fixture",
        fontsize=12,
    )
    # Set the document metadata so the wrapper can return title / author
    # without relying on filename fallback.
    doc.set_metadata(
        {
            "title": "Sidecar Fixture",
            "author": "Sidecar Test Suite",
        }
    )
    doc.save(str(out))
    doc.close()
    return out


@pytest.fixture()
def minimal_epub(tmp_path: Path) -> Path:
    """Build a minimal EPUB-2 archive by hand (no external dependency).

    Structure follows the EPUB 2.0 spec: ``mimetype`` is the first ZIP
    entry (uncompressed) and ``META-INF/container.xml`` points at the
    OPF package document. The OPF declares a single chapter in the
    spine whose body text contains the title so the extractor can find
    something meaningful.
    """
    out = tmp_path / "fixture.epub"
    with zipfile.ZipFile(out, "w") as zf:
        # mimetype must be the first entry and uncompressed
        zf.writestr(
            zipfile.ZipInfo("mimetype"),
            "application/epub+zip",
            compress_type=zipfile.ZIP_STORED,
        )
        zf.writestr(
            "META-INF/container.xml",
            """<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
""",
        )
        zf.writestr(
            "OEBPS/content.opf",
            """<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Sidecar EPUB Fixture</dc:title>
    <dc:creator>Sidecar Test Suite</dc:creator>
    <dc:identifier id="bookid">urn:uuid:00000000-0000-0000-0000-000000000001</dc:identifier>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
  </spine>
</package>
""",
        )
        zf.writestr(
            "OEBPS/ch1.xhtml",
            """<?xml version='1.0' encoding='utf-8'?>
<html xmlns='http://www.w3.org/1999/xhtml'>
  <head><title>Sidecar EPUB Fixture</title></head>
  <body>
    <h1>Sidecar EPUB Fixture</h1>
    <p>Sample chapter body for the sidecar fixture.</p>
  </body>
</html>
""",
        )
    return out


@pytest.fixture()
def minimal_docx(tmp_path: Path) -> Path:
    """Build a minimal DOCX (Office Open XML) using stdlib ``zipfile``.

    A DOCX is a ZIP containing ``[Content_Types].xml``, ``_rels/.rels``,
    ``word/document.xml`` and ``docProps/core.xml``. We seed the title
    in ``core.xml`` so the extractor picks it up.
    """
    out = tmp_path / "fixture.docx"
    with zipfile.ZipFile(out, "w") as zf:
        zf.writestr(
            "[Content_Types].xml",
            """<?xml version='1.0' encoding='utf-8'?>
<Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'>
  <Default Extension='rels' ContentType='application/vnd.openxmlformats-package.relationships+xml'/>
  <Default Extension='xml' ContentType='application/xml'/>
  <Override PartName='/word/document.xml' ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'/>
  <Override PartName='/docProps/core.xml' ContentType='application/vnd.openxmlformats-package.core-properties+xml'/>
</Types>
""",
        )
        zf.writestr(
            "_rels/.rels",
            """<?xml version='1.0' encoding='utf-8'?>
<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'>
  <Relationship Id='rId1' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument' Target='word/document.xml'/>
</Relationships>
""",
        )
        zf.writestr(
            "docProps/core.xml",
            """<?xml version='1.0' encoding='utf-8'?>
<cp:coreProperties xmlns:cp='http://schemas.openxmlformats.org/package/2006/metadata/core-properties'
                   xmlns:dc='http://purl.org/dc/elements/1.1/'
                   xmlns:dcterms='http://purl.org/dc/terms/'
                   xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance'>
  <dc:title>Sidecar DOCX Fixture</dc:title>
  <dc:creator>Sidecar Test Suite</dc:creator>
</cp:coreProperties>
""",
        )
        zf.writestr(
            "word/document.xml",
            """<?xml version='1.0' encoding='utf-8'?>
<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'>
  <w:body>
    <w:p><w:r><w:t>Sidecar DOCX Fixture body text.</w:t></w:r></w:p>
  </w:body>
</w:document>
""",
        )
    return out


@pytest.fixture()
def minimal_png(tmp_path: Path) -> Path:
    """Generate a 16x16 red PNG with Pillow."""
    from PIL import Image

    out = tmp_path / "fixture.png"
    image = Image.new("RGB", (16, 16), color=(255, 0, 0))
    image.save(out, format="PNG")
    return out


@pytest.fixture()
def minimal_jpeg(tmp_path: Path) -> Path:
    """Generate a 32x32 green JPEG with Pillow."""
    from PIL import Image

    out = tmp_path / "fixture.jpg"
    image = Image.new("RGB", (32, 32), color=(0, 255, 0))
    image.save(out, format="JPEG")
    return out


@pytest.fixture()
def minimal_cbz(tmp_path: Path) -> Path:
    """Build a minimal CBZ with two page JPEGs and a non-image entry."""
    from PIL import Image

    out = tmp_path / "fixture.cbz"
    page_a = tmp_path / "_a.jpg"
    page_b = tmp_path / "_b.jpg"
    Image.new("RGB", (8, 8), color=(255, 255, 0)).save(page_a, format="JPEG")
    Image.new("RGB", (8, 8), color=(0, 0, 255)).save(page_b, format="JPEG")

    with zipfile.ZipFile(out, "w") as zf:
        zf.write(page_a, arcname="page-01.jpg")
        zf.write(page_b, arcname="page-02.jpg")
        # Non-image entry to confirm the extractor filters by extension
        zf.writestr("readme.txt", "CBZ fixture")
    return out


@pytest.fixture()
def minimal_chm(tmp_path: Path) -> Path:
    """Build a minimal CHM file with the ITSF magic header and a title block.

    The MVP CHM extractor scans for an embedded ``<title>`` block in the
    first 256 KB of the file. We seed both the ITSF magic and a tiny
    HTML title to make the fallback path return a useful title.
    """
    out = tmp_path / "fixture.chm"
    body = (
        b"ITSF"  # 4-byte magic
        + b"\x03\x00\x00\x00"  # version
        + b"\x00" * 92  # rest of the 96-byte ITSF header (zero-filled)
        + b"<html><head><title>Sidecar CHM Fixture</title></head>"
        b"<body><p>Body content.</p></body></html>"
    )
    out.write_bytes(body)
    return out


@pytest.fixture()
def minimal_djvu(tmp_path: Path) -> Path:
    """Build a placeholder DjVu file (magic + body).

    Real DjVu decoding needs the ``djvulibre`` binaries; without them
    the MVP fallback path returns a minimal ``ExtractedMetadata`` with
    the filename stem as title. We at least set the file extension and
    magic so the extractor accepts the file.
    """
    out = tmp_path / "fixture.djvu"
    # DjVu files start with "AT&TFORM" + 4-byte big-endian length + "DJVU" / "DJVM"
    out.write_bytes(b"AT&TFORM\x00\x00\x00\x14DJVMDIRM\x00\x00\x00\x00")
    return out


@pytest.fixture()
def minimal_audio(tmp_path: Path) -> Path:
    """Build a tiny WAV file with stdlib ``wave`` (no third-party libs)."""
    import wave

    out = tmp_path / "fixture.wav"
    with wave.open(str(out), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(b"\x00\x00" * 400)  # 0.05s of silence
    return out


@pytest.fixture()
def minimal_audio_with_tags(tmp_path: Path) -> Path:
    """Build a tiny WAV with ID3 tags so mutagen can extract real metadata.

    Skips the fixture if mutagen is not importable — in that
    environment the wrapper falls back to the filename stem and the
    mutagen-missing test path covers the contract. We use ``mutagen.wave.WAVE``
    rather than building a raw MP3 frame by hand; ``WAVE.add_tags()``
    writes an ``ID3 `` chunk into the RIFF container that
    ``mutagen.File()`` picks up when scanning the file.
    """
    pytest.importorskip("mutagen")
    import wave
    from mutagen.id3 import ID3NoHeaderError, TIT2, TPE1
    from mutagen.wave import WAVE

    out = tmp_path / "fixture-tagged.wav"
    with wave.open(str(out), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        # 0.5s of silence so mutagen's WaveStreamInfo has a positive
        # length to report.
        w.writeframes(b"\x00\x00" * 4000)

    wav = WAVE(out)
    try:
        wav.add_tags()
    except ID3NoHeaderError:
        # If the container pre-existed with no ID3 block, force it.
        from mutagen.id3 import ID3

        wav.tags = ID3()
    wav.tags.add(TIT2(encoding=3, text="Sidecar Audio Fixture"))
    wav.tags.add(TPE1(encoding=3, text="Sidecar Test Suite"))
    wav.save()
    return out


@pytest.fixture()
def minimal_video(tmp_path: Path) -> Path:
    """Build a placeholder MP4 file. The MVP extractor falls back to a
    minimal metadata dict when ffprobe is missing, but the file must at
    least exist with the right extension so the dispatcher can route it.
    """
    out = tmp_path / "fixture.mp4"
    # Smallest valid MP4 box: ftyp
    out.write_bytes(b"\x00\x00\x00\x14ftypisom\x00\x00\x00\x00isomavc1")
    return out