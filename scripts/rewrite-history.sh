#!/usr/bin/env bash
# One-time pre-publication history rewrite.
#
# Rewrites the author/committer identity on every commit and strips the
# Claude-Session line from every message, keeping Co-Authored-By attribution.
#
# SAFE ONLY WHILE UNPUSHED. After a push this would be a rewrite of published
# history, which is a different act with a different blast radius — do not run
# it then without deciding that explicitly.
set -euo pipefail

NAME="${FAR_AUTHOR_NAME:?set FAR_AUTHOR_NAME}"
EMAIL="${FAR_AUTHOR_EMAIL:?set FAR_AUTHOR_EMAIL}"

if [ -n "$(git status --porcelain)" ]; then
  echo "working tree is dirty — commit or stash first" >&2; exit 1
fi
git tag -f pre-rewrite-backup >/dev/null   # escape hatch: git reset --hard pre-rewrite-backup

git filter-branch --force \
  --env-filter "
    export GIT_AUTHOR_NAME='$NAME'    GIT_AUTHOR_EMAIL='$EMAIL'
    export GIT_COMMITTER_NAME='$NAME' GIT_COMMITTER_EMAIL='$EMAIL'
  " \
  --msg-filter 'grep -v "^Claude-Session: " || true' \
  -- --all

echo
echo "rewritten. verify before pushing:"
echo "  git log --format='%an <%ae>' | sort -u"
echo "  git log --format='%B' | grep -c Claude-Session   # expect 0"
echo "  git log --format='%B' | grep -c Co-Authored-By   # expect unchanged"
echo "undo with: git reset --hard pre-rewrite-backup"
