"""Command-line interface for the ``alejandria-sidecar`` package.

The CLI is built on the stdlib :mod:`argparse` to keep dependencies at
zero for the scaffolding commit. Subcommands are wired through
``argparse`` subparsers, and each stub handler emits a stable JSON
envelope with a ``schema_version`` key so that downstream consumers
(NestJS workers, Next.js server actions, Electron main) can rely on a
predictable shape.

The full extractor behaviour is intentionally NOT implemented in this
commit — only the dispatching surface area (help, version, stub JSON
errors) is in scope. Per-format wrappers land in subsequent commits
following strict TDD: see ``openspec/changes/alejandria-v2/tasks.md``
Phase 1 tasks 1.3 onward for the per-format rollout.
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from . import __version__
from ._bootstrap import bootstrap as _bootstrap_mvp

SCHEMA_VERSION = 1

# Exit codes mandated by ``specs/python-sidecar-cli/spec.md`` §
# "Deterministic exit codes".
EXIT_OK = 0
EXIT_INVALID_ARGS = 2
EXIT_UNKNOWN_FORMAT = 3
EXIT_BACKEND_UNAVAILABLE = 4
EXIT_FILE_UNREADABLE = 5


def _emit(payload: dict[str, Any]) -> None:
    """Write a single JSON object to stdout and flush.

    Using ``print`` with a trailing newline (the default) keeps the
    output stream-friendly for line-delimited JSON consumers.
    """
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def _emit_error(code: str, message: str) -> None:
    """Write a ``schema_version=1`` error envelope to stdout.

    Errors go to stdout (not stderr) so the consumer can read one
    well-formed JSON document regardless of the exit code. The exit
    code itself carries the failure category.
    """
    _emit(
        {
            "schema_version": SCHEMA_VERSION,
            "error": {"code": code, "message": message},
        }
    )


def _stub_handler(subcommand: str, _args: argparse.Namespace) -> int:
    """Placeholder handler for every not-yet-implemented subcommand.

    The real implementations land in Phase 1 tasks 1.5 (ocr) and the
    scanner subcommand (Phase 2 in the spec). For now we emit a stable
    error envelope and exit with ``EXIT_INVALID_ARGS`` so the contract
    is testable.
    """
    _emit_error(
        "NOT_IMPLEMENTED",
        f"{subcommand} subcommand is not yet implemented",
    )
    return EXIT_INVALID_ARGS


# Exit-code mapping for extract subcommand errors. Keeps the mapping
# localised so the spec's exit-code table can be regenerated easily.
_EXTRACT_ERROR_EXIT_CODE: dict[str, int] = {
    "FILE_UNREADABLE": EXIT_FILE_UNREADABLE,
    "UNKNOWN_FORMAT": EXIT_UNKNOWN_FORMAT,
    "BACKEND_UNAVAILABLE": EXIT_BACKEND_UNAVAILABLE,
    "NOT_IMPLEMENTED": EXIT_INVALID_ARGS,
}


def _handle_extract(args: argparse.Namespace) -> int:
    """Dispatch the ``extract`` subcommand to the right per-format wrapper.

    The dispatcher reads the file extension, picks a wrapper, and
    delegates. The wrapper returns either a JSON-ready dict on success
    or a dict containing an ``error`` envelope on failure — we
    translate the envelope's ``code`` field into the spec's exit-code
    table.
    """
    from pathlib import Path  # local import keeps top-of-file cost minimal

    from .extractors.dispatch import dispatch_extract

    raw = Path(args.path)
    payload = dispatch_extract(raw)

    _emit(payload)

    err = payload.get("error") if isinstance(payload, dict) else None
    if err is None:
        return EXIT_OK

    code = err.get("code") if isinstance(err, dict) else None
    if code in _EXTRACT_ERROR_EXIT_CODE:
        return _EXTRACT_ERROR_EXIT_CODE[code]
    # Unknown error code — treat as invalid usage but emit the envelope.
    return EXIT_INVALID_ARGS


def build_parser() -> argparse.ArgumentParser:
    """Construct the top-level argument parser.

    Exposed as a public function so tests can introspect the parser
    without invoking ``main``.
    """
    parser = argparse.ArgumentParser(
        prog="alejandria-sidecar",
        description="CLI shim for Python extractors and OCR.",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"alejandria-sidecar {__version__}",
    )

    subparsers = parser.add_subparsers(
        title="Commands",
        dest="command",
        metavar="COMMAND",
    )

    extract = subparsers.add_parser(
        "extract",
        help="Run a metadata extractor on a file",
        description="Run a metadata extractor on a file.",
    )
    extract.add_argument("path", help="Absolute path to the input file")
    extract.set_defaults(handler=_handle_extract)

    ocr = subparsers.add_parser(
        "ocr",
        help="Run OCR on an image or PDF (NOT IMPLEMENTED YET)",
        description="Run OCR on an image or PDF.",
    )
    ocr.add_argument("path", help="Absolute path to the input file")
    ocr.set_defaults(handler=lambda args: _stub_handler("ocr", args))

    scan = subparsers.add_parser(
        "scan",
        help="Scan a folder and report file types (NOT IMPLEMENTED YET)",
        description="Scan a folder and report file types.",
    )
    scan.add_argument(
        "folder",
        nargs="?",
        default=".",
        help="Folder to scan (defaults to the current directory)",
    )
    scan.set_defaults(handler=lambda args: _stub_handler("scan", args))

    return parser


def main(argv: list[str] | None = None) -> int:
    """Entry point used by both ``python -m alejandria_sidecar`` and the
    ``alejandria-sidecar`` console script declared in ``pyproject.toml``.
    """
    # Bootstrap must run before any wrapper touches ``alejandria.*``.
    _bootstrap_mvp()
    parser = build_parser()
    args = parser.parse_args(argv)

    handler = getattr(args, "handler", None)
    if handler is None:
        # ``--help`` and ``--version`` are handled by argparse before we
        # reach this point. If we land here without a subcommand the
        # user typed bare ``alejandria-sidecar`` — show help and exit 2
        # (treat as invalid usage).
        parser.print_help(sys.stderr)
        return EXIT_INVALID_ARGS

    return handler(args)


if __name__ == "__main__":
    raise SystemExit(main())