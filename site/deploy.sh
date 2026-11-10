#!/bin/sh
# Deploys site/ to tweetpicker.weierz.com on DMIT.
# Cloudflare caches .css/.js, so each "?v=dev" reference is stamped with a hash of that file.
set -e
cd "$(dirname "$0")"
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
rsync -aL --exclude deploy.sh ./ "$out/"
for f in style.css card.js demo.js; do
  h=$(shasum "$out/$f" | cut -c1-10)
  find "$out" -name '*.html' -exec sed -i '' "s|/$f?v=dev|/$f?v=$h|g" {} +
done
rsync -a --delete --no-owner --no-group "$out/" dmit:/var/www/tweetpicker.weierz.com/
ssh dmit 'chown -R root:root /var/www/tweetpicker.weierz.com'
echo "deployed: https://tweetpicker.weierz.com/"
