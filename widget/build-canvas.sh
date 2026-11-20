#!/bin/bash
# Builds the Canvas version of a page: one small page per runnable block,
# for iframes, and the page's text as Markdown with the iframes in place of
# the blocks (for mkdocstocanvas, or any Markdown-to-HTML step).
#
#   widget/build-canvas.sh PAGE.md OUT_DIR BASE_URL [THUNK_URL]
#
# Writes OUT_DIR/NAME.md and OUT_DIR/NAME/1.html, 2.html, ..., with
# notes.js and thunk.css in OUT_DIR. BASE_URL is the address where OUT_DIR
# will be served (the iframes point to BASE_URL/NAME/N.html). THUNK_URL
# defaults to Thunk running locally, http://localhost:8123.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
page=$1
outdir=$2
base=${3%/}
thunk=${4:-http://localhost:8123}

name=$(basename "$page" .md)
mkdir -p "$outdir/$name"
rm -f "$outdir/$name"/*.html
cp "$here/notes.js" "$here/thunk.css" "$outdir/"
version=$(cat "$here/notes.js" "$here/thunk.css" | shasum | cut -c1-10)
# names.lua first, then a site's own filters and settings (as in build.sh)
opts=(--lua-filter "$here/names.lua")
for f in ${THUNK_FILTERS:-}; do opts+=(--lua-filter "$f"); done
if [ -n "${THUNK_METADATA:-}" ]; then opts+=(--metadata-file "$THUNK_METADATA"); fi

# The number of runnable blocks: count the iframes in the Markdown version.
pandoc "$page" -f markdown -t gfm "${opts[@]}" --lua-filter "$here/canvas.lua" \
  -M hs-mode=canvas -M hs-base="$base" -M hs-name="$name" -o "$outdir/$name.md"
count=$(grep -c '^<iframe ' "$outdir/$name.md" || true)

for n in $(seq 1 "$count"); do
  pandoc "$page" -f markdown -t html5 --standalone "${opts[@]}" \
    --template "$here/embed.html" --lua-filter "$here/canvas.lua" --lua-filter "$here/filter.lua" \
    -M hs-mode=embed -M hs-block="$n" \
    --syntax-highlighting=none -V thunk="$thunk" -V hint="${HINT_URL:-}" -V hint-by="${HINT_BY:-}" -V events="${EVENTS_URL:-}" -V widget="../" -V version="$version" \
    -o "$outdir/$name/$n.html"
done
echo "Wrote $outdir/$name.md and $count block pages in $outdir/$name/"
