#!/usr/bin/env bash
# sign-and-notarize.sh — codesign + notarize flow for `@alejandria/mac`
# (PR-N8, issue #94).
#
# Wraps `electron-builder --mac` so the CI runner can sign and
# notarize the .app in a single pass. Refuses to run if any of the
# mandatory Apple credentials are missing, then BLOCKS on
# `xcrun notarytool submit --wait` so the build only exits 0 after
# Apple has approved the binary (see PR-4D postmortem — the
# fire-and-forget flow shipped a build whose tickets never
# arrived).
#
# Usage:
#   APPLE_ID=... \
#   APPLE_APP_SPECIFIC_PASSWORD=... \
#   APPLE_TEAM_ID=... \
#   CSC_LINK=/path/to/DeveloperID.p12 \
#   CSC_KEY_PASSWORD=... \
#   ./scripts/sign-and-notarize.sh
#
# Optional:
#   ELECTRON_BUILDER_CACHE=/tmp/electron-builder-cache \
#     → persisted cache dir for reuse across runs.

set -euo pipefail

if [ -z "${APPLE_ID:-}" ]; then
  echo "sign-and-notarize: APPLE_ID is required" >&2
  exit 1
fi
if [ -z "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]; then
  echo "sign-and-notarize: APPLE_APP_SPECIFIC_PASSWORD is required" >&2
  exit 1
fi
if [ -z "${APPLE_TEAM_ID:-}" ]; then
  echo "sign-and-notarize: APPLE_TEAM_ID is required" >&2
  exit 1
fi
if [ -z "${CSC_LINK:-}" ]; then
  echo "sign-and-notarize: CSC_LINK is required (.p12 path or base64)" >&2
  exit 1
fi

# Persist the cache across CI runs so the second invocation skips
# the multi-GB electron download. ELECTRON_BUILDER_CACHE is the
# canonical knob electron-builder looks at.
if [ -n "${ELECTRON_BUILDER_CACHE:-}" ]; then
  export ELECTRON_BUILDER_CACHE
fi

# 1. Compile the main process bundle.
echo "sign-and-notarize: building main process" >&2
npm run build

# 2. Package the .app via electron-forge.
echo "sign-and-notarize: packaging .app via electron-forge" >&2
npm run package

# 3. Wrap it in a DMG, codesign + notarize via electron-builder.
# --publish never so the runner does NOT call GitHub Releases
# (that's a separate `release-mac` workflow that uses `gh`).
echo "sign-and-notarize: codesign + notarize" >&2
npx electron-builder --mac --config electron-builder.yml \
  --publish never

# 4. Block on notarytool so we exit 0 only after Apple approved.
# This is intentionally AFTER the electron-builder call: the DMG is
# already at release/Alejandría-*.dmg by then, so `--wait` flips
# the moment Apple's notary service stamps it.
DMG_PATH="$(ls release/Alejandría-*.dmg 2>/dev/null | head -n 1 || true)"
if [ -z "${DMG_PATH:-}" ]; then
  echo "sign-and-notarize: no DMG found under release/" >&2
  exit 1
fi
xcrun notarytool submit "${DMG_PATH}" \
  --apple-id "${APPLE_ID}" \
  --password "${APPLE_APP_SPECIFIC_PASSWORD}" \
  --team-id "${APPLE_TEAM_ID}" \
  --wait

echo "sign-and-notarize: ok" >&2
