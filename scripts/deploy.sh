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

sudo rsync -a --delete "$ROOT/dist/" "$WEBROOT/"
sudo chown -R www-data:www-data "$WEBROOT"

echo "Deployed $ROOT/dist -> $WEBROOT"
echo "Hard-reload the tab (Ctrl+Shift+R) — /assets/ is cached immutable for a year."
