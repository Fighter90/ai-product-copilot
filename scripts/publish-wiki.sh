#!/usr/bin/env bash
# ANA-57: publish docs/wiki/*.md to the GitHub Wiki (Fighter90/ai-product-copilot.wiki).
#
# The GitHub Wiki is a separate git repo; this script mirrors docs/wiki/ into it.
# Requires push access to the wiki repo. DRY-RUN by default: pass --push to actually publish.
#
# Usage:
#   scripts/publish-wiki.sh            # clone/pull + copy + diff (dry-run)
#   scripts/publish-wiki.sh --push     # commit and push to the wiki
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/docs/wiki"
TMP="${TMPDIR:-/tmp}/pca-wiki-sync"
WIKI_GIT="https://github.com/Fighter90/ai-product-copilot.wiki.git"
PUSH=0
[[ "${1:-}" == "--push" ]] && PUSH=1

[[ -d "$SRC" ]] || { echo "docs/wiki/ not found at $SRC" >&2; exit 1; }
command -v git >/dev/null || { echo "git is required" >&2; exit 1; }

rm -rf "$TMP"
if git clone --depth 1 "$WIKI_GIT" "$TMP" 2>/dev/null; then
  # Refresh a previously cloned shallow copy.
  git -C "$TMP" pull --ff-only
else
  echo "Cannot clone $WIKI_GIT — does the wiki exist yet?" \
       "Create it once in the GitHub UI (any page) and re-run." >&2
  exit 1
fi

# Mirror: copy all wiki sources, including the en/ subdirectory
# (Home.md lands as the wiki landing page; en/ keeps its subpath).
cp -R "$SRC"/. "$TMP"/

if [[ $PUSH -eq 1 ]]; then
  if git -C "$TMP" diff --quiet && git -C "$TMP" diff --cached --quiet \
     && [ -z "$(git -C "$TMP" status --porcelain)" ]; then
    echo "Wiki is up to date — nothing to publish."
  else
    git -C "$TMP" add -A
    git -C "$TMP" commit -m "Sync wiki sources from docs/wiki ($(date -u +%F))"
    git -C "$TMP" push origin master
    echo "Published: https://github.com/Fighter90/ai-product-copilot/wiki"
  fi
else
  echo
  echo "Dry-run complete. Review the copy in $TMP and re-run with --push to publish."
  git -C "$TMP" status --short || true
fi
