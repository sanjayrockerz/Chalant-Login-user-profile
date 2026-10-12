#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
LOGS="$REPO_ROOT/logs"
mkdir -p "$LOGS"
LOG="$LOGS/login-fix-$(date +%Y%m%d-%H%M%S).log"
# tee stdout+stderr to log
exec > >(tee -a "$LOG") 2>&1

echo "Starting apply-login-fix at $(date)"

echo "Git status (before):"
git status --porcelain --branch || true

BRANCH="fix/login-page-back-dup"
# checkout or create branch
if git rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
  git checkout "$BRANCH"
else
  git checkout -b "$BRANCH"
fi

echo "On branch: $(git rev-parse --abbrev-ref HEAD)"

SRC='services/login-page-back 2'
DST='services/login-page-back'

if [ ! -d "$SRC" ]; then
  echo "Source folder not found: $SRC"
  echo "Exiting."
  exit 1
fi

mkdir -p "$DST"

# Move visible entries
echo "\nMoving visible (non-dot) entries from '$SRC' to '$DST'"
for entry in "$SRC"/*; do
  [ -e "$entry" ] || continue
  base=$(basename "$entry")
  echo "Moving: '$entry' -> '$DST/$base'"
  if git mv -f "$entry" "$DST/" 2>/dev/null; then
    echo "  moved with git mv"
  else
    echo "  git mv failed, falling back to mv + git add"
    mv -f "$entry" "$DST/"
    git add -A "$DST/$base"
  fi
done

echo "\nStaged changes after visible moves:"
git status --porcelain=1 --branch

if ! git diff --cached --quiet; then
  git commit -m "chore: move visible contents from 'login-page-back 2' into 'services/login-page-back'" || true
else
  echo "No visible changes staged for commit"
fi

# Move dotfiles (hidden)
echo "\nMoving hidden (dot) entries from '$SRC' to '$DST'"
for entry in "$SRC"/.[!.]* "$SRC"/..?*; do
  [ -e "$entry" ] || continue
  base=$(basename "$entry")
  echo "Moving hidden: '$entry' -> '$DST/$base'"
  if git mv -f "$entry" "$DST/" 2>/dev/null; then
    echo "  moved with git mv"
  else
    echo "  git mv failed, falling back to mv + git add"
    mv -f "$entry" "$DST/"
    git add -A "$DST/$base"
  fi
done

# try to remove source dir if empty
if [ -d "$SRC" ]; then
  if rmdir "$SRC" 2>/dev/null; then
    echo "Removed empty source dir: $SRC"
  else
    echo "Source dir not empty or removal failed: $SRC"
  fi
fi

echo "\nStaged changes after hidden moves:"
git status --porcelain=1 --branch

if ! git diff --cached --quiet; then
  git commit -m "chore: move hidden dotfiles from 'login-page-back 2' into 'services/login-page-back' and cleanup" || true
else
  echo "No hidden/dot changes staged for commit"
fi

# push branch
if git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then
  echo "Upstream exists; pushing branch"
  git push || echo "git push failed"
else
  echo "Setting upstream and pushing branch"
  git push --set-upstream origin "$BRANCH" || echo "git push failed"
fi

echo "Done at $(date)"
echo "Log saved to: $LOG"
# update latest symlink
ln -f "$LOG" "$LOGS/latest-login-fix.log"
