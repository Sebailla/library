"""Module entry point: ``python -m alejandria_sidecar``.

This thin shim exists so users can invoke the sidecar via
``python -m alejandria_sidecar <command> [<args>...]`` without needing
the ``alejandria-sidecar`` console script on ``PATH``. It delegates to
:func:`alejandria_sidecar.cli.main`.
"""
from __future__ import annotations

import sys

from .cli import main

if __name__ == "__main__":
    sys.exit(main())