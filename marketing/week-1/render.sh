#!/bin/zsh
# Renders every card in src/posts.js to graphics/<id>.png (1600x900) with headless Chrome, then writes POSTS.md.
# Run from anywhere: zsh "marketing/week-1/render.sh"   (or pass post ids to render just those)
set -e
DIR="${0:A:h}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$DIR/graphics"
IDS=("$@")
[[ ${#IDS} -eq 0 ]] && IDS=($(node -e 'console.log(require(process.argv[1]).POSTS.map(p=>p.id).join(" "))' "$DIR/src/posts.js"))
for id in $IDS; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files --force-device-scale-factor=1 \
    --window-size=1600,900 --virtual-time-budget=8000 --screenshot="$DIR/graphics/$id.png" "file://$DIR/src/card.html?id=$id" >/dev/null 2>&1
  echo "rendered $id"
done
node "$DIR/src/write-md.js"
