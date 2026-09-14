#!/bin/sh
# Writes version.json: a stamp plus every file the page must refetch when the stamp changes. Run by the pre-commit hook.
cd "$(dirname "$0")"
{
  printf '{"v":"%s","files":[' "$(date -u +%Y%m%d-%H%M%S)"
  ls *.js *.css *.html vendor/*.js 2>/dev/null | grep -v '^tools' | awk 'BEGIN{s=""}{printf "%s\"%s\"", s, $0; s=","}'
  printf ']}\n'
} > version.json
git add version.json
