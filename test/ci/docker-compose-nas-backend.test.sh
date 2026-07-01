# test/ci/docker-compose-nas-backend.test.sh
#
# TDD harness for services/nas-backend/docker-compose.yml.
#
# Run:
#   bash test/ci/docker-compose-nas-backend.test.sh

set -euo pipefail

COMPOSE="services/nas-backend/docker-compose.yml"

failures=0
ok() { printf '  \033[32mok\033[0m  %s\n' "$1"; }
ko() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; failures=$((failures + 1)); }

echo "==> docker-compose-nas-backend.test.sh"

if [[ -f "$COMPOSE" ]]; then
  ok "docker-compose.yml exists at $COMPOSE"
else
  ko "docker-compose.yml missing"
  exit 1
fi

# --- nas-backend service pulls from Docker Hub ---
# Use awk to extract the 'nas-backend:' service block (indentation-based,
# stops at the next top-level key) and assert against that block alone.
nas_block="$(awk '
  /^  nas-backend:/ { in_block=1; print; next }
  in_block && /^  [a-zA-Z]/ { in_block=0 }
  in_block { print }
' "$COMPOSE")"

if [[ -n "$nas_block" ]]; then
  ok "found 'nas-backend:' service block"
else
  ko "no 'nas-backend:' service block found"
fi

if grep -Eq "^[[:space:]]+image:[[:space:]]+sebailla001/alejandria-nas-bockend" <<<"$nas_block"; then
  ok "nas-backend service pulls from docker.io/sebailla001/alejandria-nas-bockend"
else
  ko "nas-backend service does NOT pull from docker.io/sebailla001/alejandria-nas-bockend"
fi

if grep -Eq "^[[:space:]]+image:[[:space:]]+sebailla001/alejandria-nas-bockend:v[0-9]+\.[0-9]+\.[0-9]+" <<<"$nas_block"; then
  ok "image tag is pinned to a vX.Y.Z release"
else
  ko "image tag is not pinned to a vX.Y.Z release"
fi

# --- local build: stanza must be commented out (or absent) ---
if grep -Eq "^[[:space:]]+build:[[:space:]]*$" <<<"$nas_block"; then
  ko "nas-backend still has an active 'build:' stanza (should be commented out)"
else
  ok "nas-backend 'build:' stanza is not active (commented out or absent)"
fi

# --- published-image usage note present in the file ---
if grep -Eq "Docker Hub" "$COMPOSE" || grep -Eq "sebailla001/alejandria-nas-bockend" "$COMPOSE"; then
  ok "compose file mentions the published image / Docker Hub"
else
  ko "compose file does not document the published image"
fi

echo
if (( failures == 0 )); then
  echo "All checks passed."
  exit 0
else
  echo "$failures check(s) failed."
  exit 1
fi