#!/bin/sh
# Copies the TV screen into the energy service, so it can be previewed in a browser at
# /tv/tv?energy with the household's real figures. The scripts are built into the page, as some
# browsers wouldn't load them as separate files from the protected test address. Run after
# changing the TV files.
set -e
cd "$(dirname "$0")/.."
mkdir -p server/tv
rm -f server/tv/config.js server/tv/qrcode.js
cp app/src/main/assets/shared.css server/tv/shared.css
cp -r app/src/main/assets/fonts server/tv/
python3 - <<'PY'
src = open("app/src/main/assets/tv.html").read()
for name in ("config.js", "qrcode.js"):
    tag = '<script src="%s"></script>' % name
    assert tag in src, tag
    body = open("app/src/main/assets/" + name).read().replace("</script", "<\\/script")
    src = src.replace(tag, "<script>/* " + name + " */\n" + body + "\n</script>")
open("server/tv/tv.html", "w").write(src)
PY
echo "Copied the TV screen into server/tv/"
