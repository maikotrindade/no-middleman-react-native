#!/usr/bin/env bash
# Git pre-commit/commit-msg guard for loop-authored commits:
# Conventional Commits prefix, and never Claude as author or co-author.
set -euo pipefail
msg_file="${1:?usage: pre-commit.sh <commit-msg-file>}"
msg=$(cat "$msg_file")

if ! grep -qE '^(feat|fix|docs|chore|test|refactor|wip)(\(.+\))?: ' <<<"$msg"; then
  echo "commit rejected: message must use a Conventional Commits prefix" >&2
  exit 1
fi
if grep -qiE 'co-authored-by:.*(claude|anthropic)' <<<"$msg"; then
  echo "commit rejected: Claude must not be author or co-author" >&2
  exit 1
fi
if git var GIT_AUTHOR_IDENT | grep -qiE 'claude|anthropic'; then
  echo "commit rejected: git author identity must be the repository owner" >&2
  exit 1
fi
