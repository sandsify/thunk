#!/bin/bash
# Builds an HTML page from a Markdown page with Haskell blocks.
#
#   widget/build.sh PAGE.md OUT_DIR [THUNK_URL]
#
# Writes OUT_DIR/PAGE.html and copies notes.js, thunk.css and page.css
# next to it.
# THUNK_URL defaults to Thunk running locally, http://localhost:8123.
# THUNK_REPLAY (environment), if set, is a recording made by
# tools/record-replay.mjs: it is copied next to the page, and the page's
# own code gets its results from it. Without a THUNK_URL the page then
# needs no server at all (changed code gets a note instead); with one,
# the server runs only changed code.
# HINT_URL (environment), if set, is the hint service (hints/):
# exercises get a Hint button, and Run errors "Explain this error".
# HINT_BY names the model for the
# notice readers see first (default "Google's Gemini").
# EVENTS_URL, if set, is the usage counter (hints/, POST /event): each
# button press is counted there, with no code and no identity.
# Page settings (front matter) are described in docs/WRITING.md.
# THUNK_METADATA (environment), if set, is a YAML file of settings for all
# pages (a page's own front matter wins), e.g. css, theme, abstract-title.
# THUNK_FILTERS, if set, is a list of extra pandoc Lua filters (separated
# by spaces), run after names.lua: a site's own ::: divs, say.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
page=$1
outdir=$2
thunk=${3:-}
if [ -z "$thunk" ] && [ -z "${THUNK_REPLAY:-}" ]; then thunk=http://localhost:8123; fi

mkdir -p "$outdir"
cp "$here/notes.js" "$here/thunk.css" "$here/page.css" "$here/qrcode.js" "$outdir/"
name=$(basename "$page" .md)
replay=""
if [ -n "${THUNK_REPLAY:-}" ]; then replay=$name.replay.json; cp "$THUNK_REPLAY" "$outdir/$replay"; fi
# A version in the script and style links, so that browsers fetch them
# again after a change instead of using a cached copy.
version=$(cat "$here/notes.js" "$here/thunk.css" "$here/page.css" | shasum | cut -c1-10)
opts=(--lua-filter "$here/names.lua")
for f in ${THUNK_FILTERS:-}; do opts+=(--lua-filter "$f"); done
if [ -n "${THUNK_METADATA:-}" ]; then opts+=(--metadata-file "$THUNK_METADATA"); fi
pandoc "$page" -f markdown -t html5 --standalone "${opts[@]}" \
  --template "$here/template.html" --lua-filter "$here/filter.lua" \
  --syntax-highlighting=none --toc --toc-depth=2 -V thunk="$thunk" -V hint="${HINT_URL:-}" -V hint-by="${HINT_BY:-}" -V events="${EVENTS_URL:-}" -V replay="$replay" -V widget="" -V version="$version" \
  -o "$outdir/$name.html"
echo "Wrote $outdir/$name.html"
