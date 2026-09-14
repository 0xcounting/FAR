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
# NOTE: do NOT rely on a tag made here as the escape hatch — `filter-branch --all`
# rewrites tags too, so the tag ends up pointing at the NEW history. The genuine
# backup is the refs/original/* that filter-branch writes itself.
#   undo:  git reset --hard refs/original/refs/heads/main
# Those refs also mean `git log --all` still shows the OLD commits afterwards,
# which looks alarming and is not: a normal `git push origin main` sends only
# what is reachable from main. Purge them before any `push --mirror`:
#   git update-ref -d refs/original/refs/heads/main
#   git reflog expire --expire=now --all && git gc --prune=now --aggressive

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
echo "undo with: git reset --hard refs/original/refs/heads/main"
