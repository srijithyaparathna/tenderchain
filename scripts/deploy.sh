#!/usr/bin/env bash
# Build the portal and publish it to the directory nginx serves.
#
# The nginx site (/etc/nginx/sites-available/tenderchain) serves
# /var/www/tenderchain, NOT this project's dist/ — so `npm run build` alone
# changes nothing in the browser. Run this instead, or the tab keeps showing
# whatever was copied across last.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEBROOT="${WEBROOT:-/var/www/tenderchain}"

cd "$ROOT"
npm run build

# This used to be a plain `rsync -a --delete`, which fails silently-ish with
# "sudo: rsync: command not found" on a box that never had rsync installed —
# the build succeeds, the publish does not, and the tab keeps serving the old
# bundle. Use rsync when it exists, otherwise do the same job with cp.
#
# Either way the publish is a swap, not an in-place edit: the new tree is
# staged beside the live one and moved into position, so nginx never serves a
# half-copied directory, and the previous release stays in $WEBROOT.old for a
# one-command rollback.
STAGE="${WEBROOT}.new"
PREV="${WEBROOT}.old"

sudo rm -rf "$STAGE"
sudo mkdir -p "$STAGE"

if command -v rsync >/dev/null 2>&1; then
  sudo rsync -a --delete "$ROOT/dist/" "$STAGE/"
else
  sudo cp -a "$ROOT/dist/." "$STAGE/"
fi

sudo chown -R www-data:www-data "$STAGE"

sudo rm -rf "$PREV"
if [ -d "$WEBROOT" ]; then
  sudo mv "$WEBROOT" "$PREV"
fi
sudo mv "$STAGE" "$WEBROOT"

echo "Deployed $ROOT/dist -> $WEBROOT"
echo "Previous release kept at $PREV (roll back: sudo rm -rf $WEBROOT && sudo mv $PREV $WEBROOT)"
echo "Hard-reload the tab (Ctrl+Shift+R) — /assets/ is cached immutable for a year."
