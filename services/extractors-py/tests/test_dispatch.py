"""Tests for the sidecar CLI's extension-based dispatch.

The dispatcher in ``extractors.dispatch`` is the single source of
truth for which wrapper handles which extension. These tests verify
the public contract:

* Unknown extensions return an ``UNKNOWN_FORMAT`` envelope and the
  CLI exits with code 3.
* Missing files (regardless of extension) return a ``FILE_UNREADABLE``
  envelope and the CLI exits with code 5.
"""
from __future__ import annotations

import json
from pathlib import Path


def test_cli_extract_unknown_extension_returns_unknown_format(
    tmp_path: Path,
) -> None:
    from .conftest import run_cli  # type: ignore[import-not-found]

    bogus = tmp_path / "thing.xyz"
    bogus.write_bytes(b"placeholder")

    result = run_cli("extract", str(bogus))
    assert result.returncode == 3, (
        f"unknown format must exit 3; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert payload["error"]["code"] == "UNKNOWN_FORMAT"


def test_cli_extract_missing_file_returns_file_unreadable(tmp_path: Path) -> None:
    from .conftest import run_cli  # type: ignore[import-not-found]

    bogus = tmp_path / "missing.pdf"

    result = run_cli("extract", str(bogus))
    assert result.returncode == 5, (
        f"missing file must exit 5; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert payload["error"]["code"] == "FILE_UNREADABLE"


def test_dispatch_returns_envelope_for_known_extension(minimal_pdf: Path) -> None:
    """Direct call into the dispatcher (no subprocess) must work too."""
    from alejandria_sidecar.extractors.dispatch import dispatch_extract

    envelope = dispatch_extract(minimal_pdf)
    assert envelope["schema_version"] == 1
    assert envelope["format"] == "pdf"
    assert envelope["extractor_name"] == "pdf"


def test_dispatch_returns_unknown_format_envelope_for_unknown(
    tmp_path: Path,
) -> None:
    from alejandria_sidecar.extractors.dispatch import dispatch_extract

    bogus = tmp_path / "thing.qwe"
    bogus.write_bytes(b"x")

    envelope = dispatch_extract(bogus)
    assert envelope["schema_version"] == 1
    assert envelope["error"]["code"] == "UNKNOWN_FORMAT"


def test_dispatch_returns_file_unreadable_envelope_when_missing(
    tmp_path: Path,
) -> None:
    from alejandria_sidecar.extractors.dispatch import dispatch_extract

    bogus = tmp_path / "missing.pdf"
    envelope = dispatch_extract(bogus)
    assert envelope["schema_version"] == 1
    assert envelope["error"]["code"] == "FILE_UNREADABLE"