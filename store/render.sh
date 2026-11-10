#!/bin/sh
# Renders store/shots.html into 1280x800 Chrome Web Store screenshots (24-bit PNG, no alpha).
set -e
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p screenshots
for s in 1 2 3 4; do
  out="screenshots/screenshot-$s.png"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1280,800 --virtual-time-budget=8000 --allow-file-access-from-files \
    --screenshot="$PWD/$out" "file://$PWD/shots.html?s=$s" >/dev/null 2>&1
  # Re-encode through JPEG and back to drop the alpha channel.
  sips -s format jpeg -s formatOptions 95 "$out" --out /tmp/tp-$s.jpg >/dev/null
  sips -s format png /tmp/tp-$s.jpg --out "$out" >/dev/null
  rm /tmp/tp-$s.jpg
  echo "$out $(sips -g pixelWidth -g pixelHeight -g hasAlpha "$out" | awk 'NR>1{printf "%s ", $2}')"
done
