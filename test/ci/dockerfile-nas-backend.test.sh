#!/usr/bin/env bash
#
# test/ci/dockerfile-nas-backend.test.sh
#
# TDD harness for services/nas-backend/Dockerfile.
#
# The Dockerfile is config, but we can still assert structural and
# annotation requirements with grep. This keeps us honest about the
# Dockerfile's contract before/after edits.
#
# Run:
#   bash test/ci/dockerfile-nas-backend.test.sh

set -euo pipefail

DOCKERFILE="services/nas-backend/Dockerfile"

failures=0
ok() { printf '  \033[32mok\033[0m  %s\n' "$1"; }
ko() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; failures=$((failures + 1)); }

echo "==> dockerfile-nas-backend.test.sh"

if [[ -f "$DOCKERFILE" ]]; then
  ok "Dockerfile exists at $DOCKERFILE"
else
  ko "Dockerfile missing at $DOCKERFILE"
  exit 1
fi

# --- multi-stage structure preserved ---
for stage in "AS build" "AS deps" "AS runtime"; do
  if grep -q "$stage" "$DOCKERFILE"; then
    ok "stage '$stage' present"
  else
    ko "stage '$stage' missing (multi-stage layout broken)"
  fi
done

# --- pinned base image ---
if grep -Eq "^FROM node:20-bookworm-slim" "$DOCKERFILE"; then
  ok "pinned to node:20-bookworm-slim"
else
  ko "not pinned to node:20-bookworm-slim"
fi

# --- HEALTHCHECK using /livez ---
if grep -Eq "^HEALTHCHECK " "$DOCKERFILE"; then
  ok "HEALTHCHECK directive present"
else
  ko "HEALTHCHECK directive missing"
fi

if grep -Eq "/livez" "$DOCKERFILE"; then
  ok "HEALTHCHECK targets /livez endpoint"
else
  ko "HEALTHCHECK does not target /livez"
fi

# --- OCI image annotations ---
for label in \
  "org.opencontainers.image.title" \
  "org.opencontainers.image.description" \
  "org.opencontainers.image.source" \
  "org.opencontainers.image.licenses" \
  "org.opencontainers.image.version" \
  "org.opencontainers.image.created" \
  "org.opencontainers.image.revision"
do
  # Accept either a standalone LABEL line OR a LABEL block (multi-line with
  # backslash-continuation) — match the label key anywhere in the LABEL
  # stanza, not just the first line.
  if awk '
    /^[[:space:]]*LABEL[[:space:]]/ { in_label=1 }
    in_label { print }
    in_label && /^[^[:space:]]/ && !/^LABEL/ { in_label=0 }
  ' "$DOCKERFILE" | grep -Fq "$label="; then
    ok "LABEL $label present"
  else
    ko "LABEL $label missing"
  fi
done

# --- build args consumed ---
if grep -Eq "^ARG (VERSION|VCS_REF|BUILD_DATE)" "$DOCKERFILE"; then
  ok "declares VERSION/VCS_REF/BUILD_DATE ARGs"
else
  ko "does not declare VERSION/VCS_REF/BUILD_DATE ARGs"
fi

echo
if (( failures == 0 )); then
  echo "All checks passed."
  exit 0
else
  echo "$failures check(s) failed."
  exit 1
fi