#!/usr/bin/env bash
#
# test/ci/docker-publish.test.sh
#
# TDD RED/GREEN harness for .github/workflows/docker-publish.yml.
#
# This is the closest thing to a unit test we have for a GitHub Actions
# workflow file: it asserts the workflow's structural and semantic
# requirements using a small set of grep checks, and shells out to
# actionlint (if installed) for syntax-level validation.
#
# Run:
#   bash test/ci/docker-publish.test.sh
#
# Exit code 0 = all checks pass; non-zero = at least one check failed.

set -euo pipefail

WORKFLOW=".github/workflows/docker-publish.yml"

failures=0
ok() { printf '  \033[32mok\033[0m  %s\n' "$1"; }
ko() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; failures=$((failures + 1)); }

echo "==> docker-publish.test.sh"

# --- file presence ---
if [[ -f "$WORKFLOW" ]]; then
  ok "workflow file exists at $WORKFLOW"
else
  ko "workflow file missing at $WORKFLOW"
  echo
  echo "RED phase: workflow file has not been written yet."
  echo "Next step: write .github/workflows/docker-publish.yml."
  exit 1
fi

# --- trigger surface ---
if grep -Eq "^on:" "$WORKFLOW"; then
  ok "declares 'on' trigger block"
else
  ko "missing top-level 'on:' trigger"
fi

if grep -Eq "^\s*push:" "$WORKFLOW"; then
  ok "push trigger present"
else
  ko "missing push trigger"
fi

if grep -Eq "tags:" "$WORKFLOW" && grep -Eq "v\*" "$WORKFLOW"; then
  ok "push trigger filters on v* tags"
else
  ko "push trigger does not filter on v* tags"
fi

if grep -Eq "^\s*workflow_dispatch:" "$WORKFLOW"; then
  ok "workflow_dispatch trigger present"
else
  ko "missing workflow_dispatch trigger"
fi

# --- jobs ---
if grep -Eq "^jobs:" "$WORKFLOW"; then
  ok "declares jobs block"
else
  ko "missing jobs block"
fi

# --- platform matrix (multi-arch) ---
if grep -Eq "platforms:" "$WORKFLOW"; then
  ok "uses docker buildx platforms matrix"
else
  ko "missing platforms matrix (multi-arch)"
fi

if grep -Eq "linux/amd64" "$WORKFLOW" && grep -Eq "linux/arm64" "$WORKFLOW"; then
  ok "covers linux/amd64 and linux/arm64"
else
  ko "missing linux/amd64 and/or linux/arm64"
fi

# --- build args ---
if grep -Eq "VERSION" "$WORKFLOW" && grep -Eq "VCS_REF" "$WORKFLOW"; then
  ok "declares VERSION and VCS_REF build args"
else
  ko "missing VERSION and/or VCS_REF build args"
fi

# --- cache ---
if grep -Eq "cache-from" "$WORKFLOW" && grep -Eq "type=gha" "$WORKFLOW"; then
  ok "uses GHA layer cache"
else
  ko "missing GHA layer cache"
fi

# --- provenance off ---
if grep -Eq "provenance:\s*false" "$WORKFLOW"; then
  ok "provenance disabled (avoids SLSA friction)"
else
  ko "provenance not explicitly disabled"
fi

# --- push target ---
if grep -Eq "docker.io/sebailla001/alejandria-nas-bockend" "$WORKFLOW"; then
  ok "targets docker.io/sebailla001/alejandria-nas-bockend"
else
  ko "does not target docker.io/sebailla001/alejandria-nas-bockend"
fi

# --- secrets-based login ---
if grep -Eq "DOCKERHUB_USERNAME" "$WORKFLOW" && grep -Eq "DOCKERHUB_TOKEN" "$WORKFLOW"; then
  ok "uses DOCKERHUB_USERNAME and DOCKERHUB_TOKEN secrets"
else
  ko "does not reference DOCKERHUB_USERNAME/DOCKERHUB_TOKEN secrets"
fi

# --- 'latest' tag only on main ---
# Acceptable patterns:
#   * Actions expression: github.ref_name == 'main' or github.ref == 'refs/heads/main'
#   * Shell env var:      GITHUB_REF_NAME == 'refs/heads/main'
if grep -Eq "github\.ref_name" "$WORKFLOW" \
  || grep -Eq "github\.ref.*refs/heads/main" "$WORKFLOW" \
  || grep -Eq "GITHUB_REF_NAME.*refs/heads/main" "$WORKFLOW"; then
  ok "tags 'latest' gated on main branch"
else
  ko "does not gate 'latest' tag on main branch"
fi

# --- actionlint syntax pass (if available) ---
if command -v actionlint >/dev/null 2>&1; then
  if actionlint "$WORKFLOW" >/tmp/docker-publish.actionlint.out 2>&1; then
    ok "actionlint reports 0 errors"
  else
    ko "actionlint reported errors:"
    sed 's/^/      /' /tmp/docker-publish.actionlint.out
  fi
else
  echo "  --  actionlint not installed; skipping syntax check"
fi

echo
if (( failures == 0 )); then
  echo "All checks passed."
  exit 0
else
  echo "$failures check(s) failed."
  exit 1
fi