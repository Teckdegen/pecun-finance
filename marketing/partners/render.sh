#!/bin/zsh
# Renders every partner card in src/partners.js to graphics/<id>.png (1600x900), then writes PARTNER_POSTS.md.
# Run: zsh "marketing/partners/render.sh"   (or pass ids to render just those)
set -e
DIR="${0:A:h}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$DIR/graphics"
IDS=("$@")
[[ ${#IDS} -eq 0 ]] && IDS=($(node -e 'console.log(require(process.argv[1]).PARTNERS.map(p=>p.id).join(" "))' "$DIR/src/partners.js"))
for id in $IDS; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files --force-device-scale-factor=1 \
    --window-size=1600,900 --virtual-time-budget=8000 --screenshot="$DIR/graphics/$id.png" "file://$DIR/src/card.html?id=$id" >/dev/null 2>&1
  echo "rendered $id"
done
node "$DIR/src/write-md.js"
