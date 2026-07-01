#!/usr/bin/env bash
#
# test/ci/readme-nas-dockerhub.test.sh
#
# Verifies the README documents the Docker Hub publishing flow:
#   * Layout block mentions the published image
#   * PR status table has a "Docker Hub publish" row
#
# Run:
#   bash test/ci/readme-nas-dockerhub.test.sh

set -euo pipefail

README=README.md

failures=0
ok() { printf '  \033[32mok\033[0m  %s\n' "$1"; }
ko() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; failures=$((failures + 1)); }

echo "==> readme-nas-dockerhub.test.sh"

if [[ -f "$README" ]]; then
  ok "$README exists"
else
  ko "$README missing"
  exit 1
fi

# --- Layout section mentions the published image ---
# Accept either a tree-style mention (`nas-backend/  ... docker pull ...`)
# or a prose mention anywhere inside the Layout block (## Layout … ## PR status).
layout_block="$(awk '
  /^## Layout/ { in_block=1; print; next }
  in_block && /^## / && !/^## Layout/ { in_block=0 }
  in_block { print }
' "$README")"

if [[ -z "$layout_block" ]]; then
  ko "could not locate '## Layout' section"
else
  if grep -Eq "docker pull|sebailla001/alejandria-nas-bockend|Docker Hub" <<<"$layout_block"; then
    ok "Layout section mentions the Docker Hub image"
  else
    ko "Layout section does NOT mention the Docker Hub image"
  fi
fi

# --- PR status table has a Docker Hub publish row ---
pr_block="$(awk '
  /^## PR status/ { in_block=1; print; next }
  in_block && /^## / && !/^## PR status/ { in_block=0 }
  in_block { print }
' "$README")"

if [[ -z "$pr_block" ]]; then
  ko "could not locate '## PR status' section"
else
  if grep -Eq "Docker Hub publish" <<<"$pr_block"; then
    ok "PR status table has a 'Docker Hub publish' row"
  else
    ko "PR status table does NOT have a 'Docker Hub publish' row"
  fi

  # --- status column reflects this PR ---
  if grep -E "Docker Hub publish" <<<"$pr_block" | grep -Eq "This PR|In review|Open"; then
    ok "Docker Hub publish row reflects current PR state"
  else
    ko "Docker Hub publish row does not reflect current PR state"
  fi
fi

# --- DOCKERHUB_SETUP.md is referenced from the README ---
if grep -Eq "DOCKERHUB_SETUP\.md" "$README"; then
  ok "$README links to DOCKERHUB_SETUP.md"
else
  ko "$README does not link to DOCKERHUB_SETUP.md"
fi

echo
if (( failures == 0 )); then
  echo "All checks passed."
  exit 0
else
  echo "$failures check(s) failed."
  exit 1
fi