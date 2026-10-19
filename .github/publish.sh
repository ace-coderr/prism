#!/usr/bin/env bash
# Publishes one of the scheduled job's data files as an asset of the "launch-index" release, in a
# way that can't leave a broken one behind (.github/workflows/launch-index.yml).
#
#   publish.sh launches.json.gz [--create "<release title>" "<release notes>"]
#
# A step before this one may have been stopped part-way, so:
#   - nothing is uploaded unless the file is there and gunzip reads it whole (the scripts write to a
#     temporary file and rename it into place, so a half-written one never appears under this name);
#   - after uploading, the published asset is downloaded and checked, and uploaded once more if what
#     came back isn't whole. `gh release upload --clobber` replaces an asset by deleting it first,
#     so a run that dies in between would otherwise leave nothing published at all.
# Missing a file is not a failure: the one already published stays, and the next run tries again.
set -uo pipefail

file="${1:?usage: publish.sh <file> [--create <title> <notes>]}"
shift

if [ ! -s "$file" ]; then
  echo "$file: nothing to publish yet; keeping whatever is already there"
  exit 0
fi
if ! gunzip -t "$file" 2>/dev/null; then
  echo "$file: didn't finish writing, so it is not published; the next run carries on from the last whole one"
  exit 0
fi

if [ "${1:-}" = "--create" ]; then
  gh release view launch-index >/dev/null 2>&1 || gh release create launch-index --prerelease --latest=false --title "$2" --notes "$3"
fi

upload() { gh release upload launch-index "$file" --clobber; }

if ! upload; then
  echo "$file: the upload failed; trying once more"
  sleep 5
  upload || { echo "$file: couldn't be published this run"; exit 0; }
fi

# make sure what is published now can be read back
check=$(mktemp -d)
if gh release download launch-index --pattern "$file" --dir "$check" 2>/dev/null && gunzip -t "$check/$file" 2>/dev/null; then
  echo "$file: published ($(du -h "$file" | cut -f1))"
else
  echo "$file: what came back wasn't whole; uploading again"
  upload || true
fi
rm -rf "$check"
