#!/usr/bin/env bash
# Lists absolute paths of empty directories under the repo root, excluding common build dirs.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTFILE="$REPO_ROOT/empty_dirs.txt"

# Exclude patterns
find "$REPO_ROOT" -type d \
  \( -path "$REPO_ROOT/.git" -o -path "$REPO_ROOT/node_modules" -o -path '*/node_modules' -o -path '*/dist' -o -path '*/build' -o -path '*/.next' -o -path '*/.venv' -o -path '*/.pytest_cache' \) -prune -o -type d -empty -print > "$OUTFILE"

echo "Wrote empty directories to: $OUTFILE"
cat "$OUTFILE" || true
