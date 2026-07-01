#!/usr/bin/env bash
#
# test/ci/docs-mirror.test.sh
#
# Verifies that English docs in DOCKERHUB_SETUP.md have a Spanish mirror
# at Documents-es/DOCKERHUB_SETUP.md and that neither contains stray
# Chinese characters (translation-tool artifacts).
#
# Run:
#   bash test/ci/docs-mirror.test.sh

set -euo pipefail

EN=DOCKERHUB_SETUP.md
ES=Documents-es/DOCKERHUB_SETUP.md

failures=0
ok() { printf '  \033[32mok\033[0m  %s\n' "$1"; }
ko() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; failures=$((failures + 1)); }

echo "==> docs-mirror.test.sh"

if [[ -f "$EN" ]]; then
  ok "$EN exists"
else
  ko "$EN missing"
  exit 1
fi

if [[ -f "$ES" ]]; then
  ok "$ES exists"
else
  ko "$ES missing"
  exit 1
fi

# --- structural sanity ---
for path in "$EN" "$ES"; do
  if grep -q "Docker Hub" "$path"; then
    ok "$path mentions Docker Hub"
  else
    ko "$path does not mention Docker Hub"
  fi

  if grep -q "DOCKERHUB_USERNAME" "$path" && grep -q "DOCKERHUB_TOKEN" "$path"; then
    ok "$path documents both DOCKERHUB_USERNAME and DOCKERHUB_TOKEN secrets"
  else
    ko "$path does not document both secrets"
  fi
done

# --- Spanish mirror uses Spanish, English mirror uses English ---
if grep -q "Docker Hub publishing" "$EN"; then
  ok "$EN uses English title"
else
  ko "$EN missing English title"
fi

if grep -q "Publicación en Docker Hub" "$ES"; then
  ok "$ES uses Spanish title"
else
  ko "$ES missing Spanish title"
fi

# --- Chinese-character lint ---
python3 - "$EN" "$ES" <<'PY'
import re, sys
han = re.compile(r'[\u4e00-\u9fff]')
for f in sys.argv[1:]:
    with open(f) as fh:
        content = fh.read()
    hits = sorted(set(han.findall(content)))
    if hits:
        print(f"FAIL: Chinese characters in {f}: {hits}")
        sys.exit(1)
    print(f"  ok  no Chinese characters in {f}")
PY

echo
if (( failures == 0 )); then
  echo "All checks passed."
  exit 0
else
  echo "$failures check(s) failed."
  exit 1
fi