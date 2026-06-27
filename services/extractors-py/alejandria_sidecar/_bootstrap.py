"""Bootstrap step: expose the read-only MVP at ``../../../biblioteca``.

The sidecar is a thin shim over the existing ``alejandria`` package
shipped in the MVP repo (``/Users/sebailla/Documents/Proyectos/2026/biblioteca``).
We do NOT add the MVP as a runtime dependency or an editable install
because (a) we want the v2 repo to ship independently and (b) the MVP
is reference code under a different licence / version control flow.

Instead, on every CLI start-up we walk up from ``__file__`` until we
find a sibling ``biblioteca/`` directory that contains the
``alejandria`` package, then prepend it to :data:`sys.path`. The
operation is idempotent — calling :func:`bootstrap` twice is a no-op.
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

log = logging.getLogger(__name__)

# Env-var override lets ops set the MVP path explicitly when the
# auto-detection heuristic can't find it (e.g. unusual install layout).
_ENV_OVERRIDE = "ALEJANDRIA_MVP_ROOT"

_BOOTSTRAPPED = False


def bootstrap() -> str | None:
    """Ensure the MVP ``alejandria`` package is importable.

    Returns the path that was added to ``sys.path``, or ``None`` when
    the MVP could not be located. The function is safe to call
    multiple times — only the first call performs the search.
    """
    global _BOOTSTRAPPED
    if _BOOTSTRAPPED:
        return None
    _BOOTSTRAPPED = True

    override = os.environ.get(_ENV_OVERRIDE)
    if override:
        candidate = Path(override).resolve()
        if (candidate / "alejandria").is_dir():
            sys.path.insert(0, str(candidate))
            log.debug("bootstrap: MVP path from env override: %s", candidate)
            return str(candidate)
        log.warning(
            "bootstrap: %s=%s but no alejandria/ package found there",
            _ENV_OVERRIDE,
            override,
        )

    # Walk up from this file's directory looking for a sibling
    # ``biblioteca`` directory that contains ``alejandria``. The
    # expected layout in dev is:
    #   2026/
    #     biblioteca/           <-- MVP (read-only)
    #       alejandria/...
    #     biblioteca-v2/        <-- sidecar (this repo)
    #       services/extractors-py/alejandria_sidecar/_bootstrap.py
    here = Path(__file__).resolve().parent
    for ancestor in (here, *here.parents):
        sibling = ancestor.parent / "biblioteca"
        if (sibling / "alejandria").is_dir():
            sys.path.insert(0, str(sibling))
            log.debug("bootstrap: MVP path auto-detected: %s", sibling)
            return str(sibling)

    log.debug("bootstrap: could not locate MVP alejandria package")
    return None


__all__ = ["bootstrap"]