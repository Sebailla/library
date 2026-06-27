"""Tests for the `alejandria-sidecar` CLI scaffolding.

These tests verify the user-facing CLI contract:

- ``alejandria-sidecar --help`` prints the top-level usage and lists the
  ``extract``, ``ocr``, and ``scan`` subcommands.
- ``alejandria-sidecar --version`` prints the package version.
- Each stub subcommand returns a JSON error envelope with code
  ``NOT_IMPLEMENTED`` and exits non-zero (exit code 2).

The CLI is invoked through ``python -m alejandria_sidecar`` so that the
tests work without requiring the package to be installed in editable mode.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

# Path to the repo root that contains the ``services/extractors-py/``
# project. The tests are designed to run from that project directory.
PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    """Invoke the CLI in a subprocess and return the captured result."""
    return subprocess.run(
        [sys.executable, "-m", "alejandria_sidecar", *args],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        timeout=30,
    )


def test_help_lists_top_level_usage() -> None:
    result = _run_cli("--help")

    assert result.returncode == 0, (
        f"--help must exit 0; got {result.returncode}\n"
        f"stdout:\n{result.stdout}\n"
        f"stderr:\n{result.stderr}"
    )
    # argparse lowercases "Usage:" to "usage:" — match either form.
    assert re.search(r"usage:", result.stdout, flags=re.IGNORECASE), (
        "expected a 'Usage:' line in --help output:\n" + result.stdout
    )
    assert "alejandria-sidecar" in result.stdout


def test_help_lists_extract_subcommand() -> None:
    result = _run_cli("--help")

    assert result.returncode == 0
    assert re.search(r"\bextract\b", result.stdout), (
        "expected `extract` subcommand in --help output:\n" + result.stdout
    )


def test_help_lists_ocr_subcommand() -> None:
    result = _run_cli("--help")

    assert result.returncode == 0
    assert re.search(r"\bocr\b", result.stdout), (
        "expected `ocr` subcommand in --help output:\n" + result.stdout
    )


def test_help_lists_scan_subcommand() -> None:
    result = _run_cli("--help")

    assert result.returncode == 0
    assert re.search(r"\bscan\b", result.stdout), (
        "expected `scan` subcommand in --help output:\n" + result.stdout
    )


def test_version_flag_prints_version() -> None:
    result = _run_cli("--version")

    assert result.returncode == 0, (
        f"--version must exit 0; got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    # The version string must look like a semver-ish X.Y.Z (or X.Y.Z.devN).
    assert re.search(r"\d+\.\d+\.\d+", result.stdout), (
        "expected a version like X.Y.Z in --version output:\n" + result.stdout
    )


@pytest.mark.parametrize("subcommand", ["ocr", "scan"])
def test_stub_subcommand_returns_not_implemented_json(
    subcommand: str, tmp_path: Path
) -> None:
    """Each stub subcommand must emit a JSON envelope with code NOT_IMPLEMENTED."""
    target = tmp_path / "dummy.bin"
    target.write_bytes(b"placeholder")

    result = _run_cli(subcommand, str(target))

    assert result.returncode != 0, (
        f"{subcommand} stub must exit non-zero; got 0.\n"
        f"stdout:\n{result.stdout}\n"
        f"stderr:\n{result.stderr}"
    )

    # The CLI writes the JSON envelope to stdout so consumers can parse it
    # without mixing in stderr noise.
    payload = json.loads(result.stdout)

    assert "error" in payload, f"missing 'error' key in: {payload}"
    assert payload["error"]["code"] == "NOT_IMPLEMENTED"
    assert subcommand in payload["error"]["message"]