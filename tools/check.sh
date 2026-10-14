#!/usr/bin/env bash
# Run every check: python builder tests, JS engine tests, catalog validation, browser smoke tests.
#   bash tools/check.sh            # everything
#   bash tools/check.sh --fast     # skip the browser smoke tests
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== vendor files";            python3 tools/vendor.py --check
echo "== python builder tests";    python3 -m unittest discover -s tests/py
echo "== js engine tests";         for f in tests/js/*.test.js; do case "$f" in *engine-audit*) continue;; esac; node "$f"; done
echo "== component catalog";       python3 tools/build_catalog.py --strict
if [[ "${1:-}" != "--fast" ]]; then
  echo "== browser smoke tests";   node tools/smoke.cjs --all
  echo "== gallery";               node tools/smoke.cjs --page gallery/index.html
fi
echo "ALL CHECKS PASSED"
