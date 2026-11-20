#!/bin/bash
# Builds an HTML page from a Markdown page with Haskell blocks.
#
#   widget/build.sh PAGE.md OUT_DIR [THUNK_URL]
#
# Writes OUT_DIR/PAGE.html and copies notes.js and notes.css next to it.
# THUNK_URL defaults to Thunk running locally, http://localhost:8123.
# HINT_URL (environment), if set, is the hint service (hints/):
# exercises get a Hint button, and Run errors "Explain this error".
# HINT_BY names the model for the
# notice readers see first (default "Google's Gemini").
# EVENTS_URL, if set, is the usage counter (hints/, POST /event): each
# button press is counted there, with no code and no identity.
# With `contents: true` in the front matter, the page starts with a table
# of contents of its ## headings. With `qr: true`, it shows a QR code of
# its own address (for class meetings: students scan it from the screen).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
page=$1
outdir=$2
thunk=${3:-http://localhost:8123}

mkdir -p "$outdir"
cp "$here/notes.js" "$here/notes.css" "$here/qrcode.js" "$outdir/"
name=$(basename "$page" .md)
# A version in the script and style links, so that browsers fetch them
# again after a change instead of using a cached copy.
version=$(cat "$here/notes.js" "$here/notes.css" | shasum | cut -c1-10)
pandoc "$page" -f markdown -t html5 --standalone \
  --template "$here/template.html" --lua-filter "$here/filter.lua" \
  --syntax-highlighting=none --toc --toc-depth=2 -V thunk="$thunk" -V hint="${HINT_URL:-}" -V hint-by="${HINT_BY:-}" -V events="${EVENTS_URL:-}" -V widget="" -V version="$version" \
  -o "$outdir/$name.html"
echo "Wrote $outdir/$name.html"
