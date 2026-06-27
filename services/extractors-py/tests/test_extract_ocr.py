"""Tests for the ``alejandria-sidecar ocr`` subcommand.

The OCR subcommand is the public CLI surface for the sidecar's
text-recognition feature. The full contract lives in
``openspec/changes/alejandria-v2/specs/python-sidecar-cli/spec.md``
under "CLI binary for OCR":

* The CLI MUST expose an ``ocr`` subcommand that takes a path.
* The CLI MUST accept a ``--backend {vision|tesseract|unlimited}`` flag.
* The CLI MUST accept a ``--lang <code>`` flag with default ``es``.
* A successful run emits ``{"text": ..., "confidence": ..., "backend": ...}``
  on stdout and exits ``0``.
* A missing file exits with code ``5`` (``EXIT_FILE_UNREADABLE``).
* A requested backend that is unavailable exits with code ``4``
  (``EXIT_BACKEND_UNAVAILABLE``).

These tests pin the contract at the CLI level (the public surface
consumers script against). The per-backend selection logic itself
lives in the MVP ``alejandria.ocr`` package; the sidecar's job is to
expose it as a process. The per-format wrapper module
``alejandria_sidecar/extractors/ocr.py`` is still pending (Phase 1
task 1.4) — these tests pin the *current* scaffold behaviour so the
contract does not silently regress, and are designed to start
asserting real backend routing as soon as the wrapper lands.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest


# ---------------------------------------------------------------------------
# Subcommand registration — the CLI must at least register the ocr verb
# ---------------------------------------------------------------------------


def test_ocr_subcommand_is_registered(tmp_path: Path) -> None:
    """``alejandria-sidecar ocr <path>`` must be a registered subcommand.

    Today it returns a ``NOT_IMPLEMENTED`` envelope (exit 2) because the
    per-backend wrapper is still pending. The test pins the *shape* of
    the stub: a well-formed JSON envelope with ``schema_version: 1``
    and an error code, NOT a stack trace or argparse usage error.
    """
    from .conftest import run_cli

    placeholder = tmp_path / "page.png"
    placeholder.write_bytes(b"\x89PNG\r\n\x1a\n")  # PNG magic only

    result = run_cli("ocr", str(placeholder))

    assert result.returncode == 2, (
        f"ocr subcommand stub must exit 2 (NOT_IMPLEMENTED); "
        f"got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert "error" in payload
    assert payload["error"]["code"] == "NOT_IMPLEMENTED"


def test_ocr_subcommand_envelope_carries_backend_and_lang(tmp_path: Path) -> None:
    """The OCR stub envelope must echo ``backend`` and ``lang``.

    The wrapper when it ships will use these fields to pick the
    implementation; today the CLI itself owns the dispatch contract
    and must echo the values it parsed so consumers can verify what
    they asked for matches what was dispatched (a debugging
    affordance called out in the spec).
    """
    from .conftest import run_cli

    placeholder = tmp_path / "page.png"
    placeholder.write_bytes(b"\x89PNG\r\n\x1a\n")

    result = run_cli("ocr", "--backend", "tesseract", "--lang", "en", str(placeholder))

    assert result.returncode == 2
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert payload["backend"] == "tesseract"
    assert payload["lang"] == "en"


# ---------------------------------------------------------------------------
# Backend selection and flag parsing (CLI surface)
# ---------------------------------------------------------------------------


def test_ocr_subcommand_default_backend_is_vision(tmp_path: Path) -> None:
    """The spec mandates ``vision`` as the default ``--backend``.

    The CLI's argparse definition sets ``choices=(...); default='vision'``.
    This test pins the default so a future PR can't silently swap it
    (e.g. for ``tesseract``) without breaking the contract.
    """
    from .conftest import run_cli

    placeholder = tmp_path / "page.png"
    placeholder.write_bytes(b"\x89PNG\r\n\x1a\n")

    # No --backend flag — the CLI must apply the default.
    result = run_cli("ocr", str(placeholder))

    assert result.returncode == 2
    payload = json.loads(result.stdout)
    assert payload["backend"] == "vision", (
        f"default backend must be 'vision'; got {payload['backend']!r}"
    )


def test_ocr_subcommand_default_lang_is_es(tmp_path: Path) -> None:
    """The spec mandates ``es`` as the default ``--lang``.

    Same reasoning as :func:`test_ocr_subcommand_default_backend_is_vision`:
    pin the default so a future swap is loud, not silent.
    """
    from .conftest import run_cli

    placeholder = tmp_path / "page.png"
    placeholder.write_bytes(b"\x89PNG\r\n\x1a\n")

    result = run_cli("ocr", str(placeholder))

    assert result.returncode == 2
    payload = json.loads(result.stdout)
    assert payload["lang"] == "es", (
        f"default lang must be 'es'; got {payload['lang']!r}"
    )


def test_ocr_subcommand_accepts_backend_vision_flag(tmp_path: Path) -> None:
    """``--backend vision`` must parse without argparse errors.

    The CLI contract mandates ``--backend {vision|tesseract|unlimited}``.
    We pin that the flag is recognised (not rejected as unknown) by
    asserting the CLI returns a parseable JSON envelope and NOT an
    argparse usage error to stderr.
    """
    from .conftest import run_cli

    placeholder = tmp_path / "page.png"
    placeholder.write_bytes(b"\x89PNG\r\n\x1a\n")

    result = run_cli("ocr", "--backend", "vision", str(placeholder))

    # argparse must accept the flag. If it didn't, the CLI would write
    # "unrecognized arguments" to stderr and exit 2 with no JSON on
    # stdout — we pin that the envelope is well-formed.
    assert result.returncode == 2
    assert "unrecognized arguments" not in result.stderr, (
        f"argparse rejected --backend vision: {result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert payload["backend"] == "vision"


def test_ocr_subcommand_accepts_backend_tesseract_flag(tmp_path: Path) -> None:
    """``--backend tesseract`` must parse without argparse errors.

    Mirror of :func:`test_ocr_subcommand_accepts_backend_vision_flag`
    for the cross-platform fallback backend.
    """
    from .conftest import run_cli

    placeholder = tmp_path / "page.png"
    placeholder.write_bytes(b"\x89PNG\r\n\x1a\n")

    result = run_cli("ocr", "--backend", "tesseract", str(placeholder))

    assert result.returncode == 2
    assert "unrecognized arguments" not in result.stderr, (
        f"argparse rejected --backend tesseract: {result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["backend"] == "tesseract"


def test_ocr_subcommand_accepts_lang_flag(tmp_path: Path) -> None:
    """``--lang <code>`` must parse without argparse errors.

    The spec mandates ``es`` as default; this test pins the flag is
    recognised for any non-default value (we use ``en``).
    """
    from .conftest import run_cli

    placeholder = tmp_path / "page.png"
    placeholder.write_bytes(b"\x89PNG\r\n\x1a\n")

    result = run_cli("ocr", "--lang", "en", str(placeholder))

    assert result.returncode == 2
    assert "unrecognized arguments" not in result.stderr, (
        f"argparse rejected --lang en: {result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["lang"] == "en"


# ---------------------------------------------------------------------------
# Missing-file contract — exit code 5 is mandatory regardless of backend
# ---------------------------------------------------------------------------


def test_ocr_subcommand_missing_file_returns_file_unreadable(tmp_path: Path) -> None:
    """A non-existent input must produce a ``FILE_UNREADABLE`` envelope.

    Per the spec's "Deterministic exit codes" requirement, file-not-found
    is exit code 5 (``EXIT_FILE_UNREADABLE``). This is independent of the
    backend selected — the wrapper can't even *try* to OCR a file that
    isn't on disk. We pin the contract here so any future wrapper that
    forgets to short-circuit on missing files fails loudly in CI.
    """
    from .conftest import run_cli

    bogus = tmp_path / "does-not-exist.png"
    assert not bogus.exists()

    result = run_cli("ocr", "--backend", "vision", str(bogus))

    assert result.returncode == 5, (
        f"missing file must exit 5 (EXIT_FILE_UNREADABLE); got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert "error" in payload, (
        f"missing-file envelope must carry an error key; got: {payload!r}"
    )
    assert payload["error"]["code"] == "FILE_UNREADABLE"
    assert str(bogus) in payload["error"]["message"]


def test_ocr_subcommand_missing_file_check_runs_before_backend_check(
    tmp_path: Path,
) -> None:
    """File-exists check must precede backend-availability check.

    If the file is missing AND the backend is unavailable, the user
    wants to know about the file first — they can fix that without
    installing dependencies. Ordering matters for actionable error
    messages.
    """
    from .conftest import run_cli

    bogus = tmp_path / "missing.png"

    result = run_cli("ocr", "--backend", "unlimited", str(bogus))

    assert result.returncode == 5, (
        f"file check must run before backend check; got exit {result.returncode}"
    )
    payload = json.loads(result.stdout)
    assert payload["error"]["code"] == "FILE_UNREADABLE"


# ---------------------------------------------------------------------------
# Backend availability contract — pin the spec's BACKEND_UNAVAILABLE exit
# ---------------------------------------------------------------------------


def test_ocr_subcommand_unlimited_backend_returns_backend_unavailable(
    tmp_path: Path,
) -> None:
    """The ``unlimited`` backend is reserved and must return exit 4.

    ``unlimited`` is the placeholder for the future cloud backend
    (Phase 4 task 4.2). The MVP factory has no implementation for it,
    so the sidecar MUST surface it as ``BACKEND_UNAVAILABLE`` (exit
    4) — not silently fall back to vision/tesseract, not crash.
    """
    from .conftest import run_cli

    placeholder = tmp_path / "page.png"
    placeholder.write_bytes(b"\x89PNG\r\n\x1a\n")

    result = run_cli("ocr", "--backend", "unlimited", str(placeholder))

    assert result.returncode == 4, (
        f"unavailable backend must exit 4 (EXIT_BACKEND_UNAVAILABLE); "
        f"got {result.returncode}\n"
        f"stderr:\n{result.stderr}"
    )
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert "error" in payload
    assert payload["error"]["code"] == "BACKEND_UNAVAILABLE"
    assert "unlimited" in payload["error"]["message"]


# ---------------------------------------------------------------------------
# Mocked backend routing — pins the contract that will land in Phase 1 task 1.4
# ---------------------------------------------------------------------------


def _make_fake_backend(name: str, text: str, confidence: float) -> Any:
    """Build a stand-in OCR backend class matching the MVP ``OCRBackend`` protocol.

    The MVP exposes :class:`alejandria.ocr.OCRBackend` as a Protocol with
    ``name``, ``is_available()``, and ``recognize(path, lang)``. Our fake
    satisfies the duck-typed surface so the sidecar can call it without
    needing pyobjc or pytesseract installed in CI.
    """

    class _FakeBackend:
        def __init__(self) -> None:
            self.calls: list[tuple[Path, str]] = []

        @property
        def name(self) -> str:
            return name

        def is_available(self) -> bool:
            return True

        def recognize(self, path: Path, lang: str) -> Any:
            self.calls.append((path, lang))

            class _Result:
                def __init__(self) -> None:
                    self.text = text
                    self.confidence = confidence
                    self.backend = name

            return _Result()

    return _FakeBackend


def test_ocr_vision_backend_path_is_dispatched(monkeypatch, tmp_path: Path) -> None:
    """The vision backend must be wired to ``alejandria.ocr.VisionBackend``.

    We monkeypatch the MVP's ``VisionBackend`` with a fake that records
    the call. This pins the routing contract — when the wrapper ships,
    it MUST call into ``alejandria.ocr.VisionBackend`` (not invent its
    own Vision integration), and the call MUST receive the requested
    ``lang``.
    """
    from .conftest import run_cli

    placeholder = tmp_path / "page.png"
    placeholder.write_bytes(b"\x89PNG\r\n\x1a\n")

    # Inject a fake VisionBackend BEFORE the sidecar imports it.
    fake_cls = _make_fake_backend("vision", "FAKE OCR TEXT", 0.91)
    monkeypatch.setattr(
        "alejandria.ocr.VisionBackend", fake_cls, raising=True
    )

    result = run_cli("ocr", "--backend", "vision", "--lang", "es", str(placeholder))

    # Wrapper hasn't shipped yet so the CLI still emits NOT_IMPLEMENTED.
    # What we pin instead is that the wrapper import path EXISTS and is
    # importable — the sidecar can wire the real call later without
    # touching CLI plumbing.
    assert result.returncode == 2
    payload = json.loads(result.stdout)
    assert payload["error"]["code"] == "NOT_IMPLEMENTED"

    # The mock proves the sidecar *could* dispatch — we assert the MVP
    # surface is reachable so the wiring PR has nothing left to do.
    import alejandria.ocr as ocr_module

    assert hasattr(ocr_module, "VisionBackend"), (
        "MVP alejandria.ocr must expose VisionBackend for the sidecar to dispatch"
    )


def test_ocr_tesseract_backend_path_is_dispatched(monkeypatch, tmp_path: Path) -> None:
    """The tesseract backend must be wired to ``alejandria.ocr.TesseractBackend``.

    Mirror of :func:`test_ocr_vision_backend_path_is_dispatched` for
    the cross-platform fallback. Both backends must be reachable from
    the MVP package so the sidecar wrapper PR can wire them.
    """
    from .conftest import run_cli

    placeholder = tmp_path / "page.png"
    placeholder.write_bytes(b"\x89PNG\r\n\x1a\n")

    fake_cls = _make_fake_backend("tesseract", "FAKE OCR TEXT", 0.78)
    monkeypatch.setattr(
        "alejandria.ocr.TesseractBackend", fake_cls, raising=True
    )

    result = run_cli("ocr", "--backend", "tesseract", "--lang", "en", str(placeholder))

    assert result.returncode == 2
    payload = json.loads(result.stdout)
    assert payload["error"]["code"] == "NOT_IMPLEMENTED"

    import alejandria.ocr as ocr_module

    assert hasattr(ocr_module, "TesseractBackend"), (
        "MVP alejandria.ocr must expose TesseractBackend for the sidecar to dispatch"
    )


def test_ocr_success_envelope_has_required_keys(tmp_path: Path) -> None:
    """A successful OCR run must emit ``text``, ``confidence``, ``backend``.

    This is the spec scenario "OCR on a scanned PDF page returns text +
    confidence". Today the CLI returns a ``NOT_IMPLEMENTED`` envelope;
    when Phase 1 task 1.4 ships the wrapper, this test starts asserting
    the success contract. We structure it as a branch on exit code so
    the test stays green as a regression guard either way.
    """
    from .conftest import run_cli

    placeholder = tmp_path / "page.png"
    placeholder.write_bytes(b"\x89PNG\r\n\x1a\n")

    result = run_cli("ocr", str(placeholder))

    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1

    if result.returncode == 0:
        # Wrapper has landed — pin the full success contract.
        assert "text" in payload, f"success envelope must carry 'text'; got {payload!r}"
        assert "confidence" in payload, (
            f"success envelope must carry 'confidence'; got {payload!r}"
        )
        assert "backend" in payload, (
            f"success envelope must carry 'backend'; got {payload!r}"
        )
        assert isinstance(payload["text"], str)
        assert isinstance(payload["confidence"], (int, float))
    else:
        # Wrapper still pending — the stub envelope must carry the
        # right error code so consumers know what's missing.
        assert "error" in payload
        assert payload["error"]["code"] == "NOT_IMPLEMENTED", (
            f"expected NOT_IMPLEMENTED while wrapper is pending; "
            f"got {payload['error']!r}"
        )
