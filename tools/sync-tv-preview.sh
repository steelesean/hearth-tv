#!/bin/sh
# Copies the TV screen into the energy service, so it can be previewed in a browser at
# /tv/tv.html?energy with the household's real figures. Run after changing the TV files.
set -e
cd "$(dirname "$0")/.."
mkdir -p server/tv
for f in tv.html config.js shared.css qrcode.js; do cp "app/src/main/assets/$f" "server/tv/$f"; done
ls app/src/main/assets/fonts >/dev/null 2>&1 && cp -r app/src/main/assets/fonts server/tv/ || true
echo "Copied the TV screen into server/tv/"
