#!/usr/bin/env bash
# Rebuilds every woff2 and OFL.txt in this directory from the google/fonts repository.
# See README.md for what is kept from each family and why.
#
#   bash apps/web/src/themes/font-files/build.sh
#
# Needs python3 (with venv), curl and network access to raw.githubusercontent.com and PyPI.
# The output is byte-for-byte reproducible: tool versions are pinned, the source commit is
# pinned, SOURCE_DATE_EPOCH fixes the head.modified timestamp, and the pure-Python GPOS/GSUB
# serializer is used instead of the HarfBuzz repacker.
set -euo pipefail

# google/fonts commit the sources come from, and that commit's author date (fontTools stamps
# head.modified with SOURCE_DATE_EPOCH).
SHA=2eb0b48d5f760f62e286216f0859a8c540dbc1bd
export SOURCE_DATE_EPOCH=1791471621

OUT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
SRC=$WORK/src

python3 -m venv "$WORK/venv"
"$WORK/venv/bin/pip" install -q fonttools==4.66.1 brotli==1.2.0
FONTTOOLS=$WORK/venv/bin/fonttools

# Unicode ranges: Google Fonts' own subsets, with the arrows widened to U+2190-2193.
LATIN="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD"
LATIN_EXT="U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF"
LATIN_WITH_EXT="$LATIN,$LATIN_EXT"
TELUGU="U+0951-0952,U+0964-0965,U+0C00-0C7F,U+1CDA,U+1CF2,U+200C-200D,U+25CC"
DEVANAGARI="U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+20A8,U+20B9,U+20F0,U+25CC,U+A830-A839,U+A8E0-A8FF"

# fetch <ofl-dir> <file>...   (OFL.txt is always fetched too)
fetch() {
  local d=$1; shift
  mkdir -p "$SRC/$d"
  for f in "$@" OFL.txt; do
    curl -sfL -o "$SRC/$d/$f" "https://raw.githubusercontent.com/google/fonts/$SHA/ofl/$d/$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$f")"
  done
}

# build <out-family-dir> <ofl-dir/source.ttf> <unicodes> [instancer axis limits...]
# Limits or pins variable axes first (wght=400:600, opsz=drop), then subsets to WOFF2. Name IDs
# 13/14 (licence description and URL) are kept next to the defaults so each file stays
# self-describing.
build() {
  local fam=$1 src=$2 uni=$3; shift 3
  local name; name=$(basename "$src" .ttf | sed 's/\[.*\]/-VF/')
  local in="$SRC/$src"
  mkdir -p "$OUT/$fam"
  if [ $# -gt 0 ]; then
    "$FONTTOOLS" varLib.instancer "$in" "$@" -o "$WORK/instanced.ttf" -q
    in="$WORK/instanced.ttf"
  fi
  "$FONTTOOLS" subset "$in" --unicodes="$uni" --layout-features='*' --name-IDs=0,1,2,3,4,5,6,13,14 \
    --no-harfbuzz-repacker --flavor=woff2 --output-file="$OUT/$fam/$name.woff2"
  cp "$SRC/$(dirname "$src")/OFL.txt" "$OUT/$fam/OFL.txt"
}

fetch instrumentserif InstrumentSerif-Regular.ttf InstrumentSerif-Italic.ttf
fetch luxuriousscript LuxuriousScript-Regular.ttf
fetch inriaserif InriaSerif-Light.ttf InriaSerif-LightItalic.ttf InriaSerif-Regular.ttf InriaSerif-Italic.ttf InriaSerif-Bold.ttf InriaSerif-BoldItalic.ttf
fetch cinzel 'Cinzel[wght].ttf'
fetch pinyonscript PinyonScript-Regular.ttf
fetch cormorantgaramond 'CormorantGaramond[wght].ttf' 'CormorantGaramond-Italic[wght].ttf'
fetch marcellus Marcellus-Regular.ttf
fetch bodonimoda 'BodoniModa[opsz,wght].ttf' 'BodoniModa-Italic[opsz,wght].ttf'
fetch manrope 'Manrope[wght].ttf'
fetch jetbrainsmono 'JetBrainsMono[wght].ttf'
fetch inter 'Inter[opsz,wght].ttf'
fetch notosanstelugu 'NotoSansTelugu[wdth,wght].ttf'
fetch notoseriftelugu 'NotoSerifTelugu[wght].ttf'
fetch notosansdevanagari 'NotoSansDevanagari[wdth,wght].ttf'
fetch notoserifdevanagari 'NotoSerifDevanagari[wdth,wght].ttf'

rm -f "$OUT"/*/*.woff2

for s in Regular Italic; do build instrument-serif instrumentserif/InstrumentSerif-$s.ttf "$LATIN_WITH_EXT"; done
build luxurious-script luxuriousscript/LuxuriousScript-Regular.ttf "$LATIN_WITH_EXT"
for s in Light LightItalic Regular Italic Bold BoldItalic; do build inria-serif inriaserif/InriaSerif-$s.ttf "$LATIN_WITH_EXT"; done
build cinzel 'cinzel/Cinzel[wght].ttf' "$LATIN_WITH_EXT" wght=400:600
build pinyon-script pinyonscript/PinyonScript-Regular.ttf "$LATIN_WITH_EXT"
build cormorant-garamond 'cormorantgaramond/CormorantGaramond[wght].ttf' "$LATIN_WITH_EXT" wght=400:600
build cormorant-garamond 'cormorantgaramond/CormorantGaramond-Italic[wght].ttf' "$LATIN_WITH_EXT" wght=400:600
build bodoni-moda 'bodonimoda/BodoniModa[opsz,wght].ttf' "$LATIN_WITH_EXT" wght=400:600 opsz=drop
build bodoni-moda 'bodonimoda/BodoniModa-Italic[opsz,wght].ttf' "$LATIN_WITH_EXT" wght=400:600 opsz=drop
build manrope 'manrope/Manrope[wght].ttf' "$LATIN_WITH_EXT" wght=300:600
build jetbrains-mono 'jetbrainsmono/JetBrainsMono[wght].ttf' "$LATIN_WITH_EXT" wght=400:500
# Inter is the body font of three themes and the largest Latin file; it stays on plain latin
# so the payload fits the 1.2 MB budget. latin-ext characters fall back per glyph.
build inter 'inter/Inter[opsz,wght].ttf' "$LATIN" opsz=drop
build noto-sans-telugu 'notosanstelugu/NotoSansTelugu[wdth,wght].ttf' "$TELUGU" wght=400:600 wdth=drop
build noto-serif-telugu 'notoseriftelugu/NotoSerifTelugu[wght].ttf' "$TELUGU" wght=400:600
build noto-sans-devanagari 'notosansdevanagari/NotoSansDevanagari[wdth,wght].ttf' "$DEVANAGARI" wght=400:600 wdth=drop
build noto-serif-devanagari 'notoserifdevanagari/NotoSerifDevanagari[wdth,wght].ttf' "$DEVANAGARI" wght=400:600 wdth=drop

# Marcellus declares a Reserved Font Name: a subset is a Modified Version (OFL s.3), so it
# ships whole, only rewrapped as WOFF2 (lossless).
mkdir -p "$OUT/marcellus"
"$FONTTOOLS" ttLib.woff2 compress -o "$OUT/marcellus/Marcellus-Regular.woff2" "$SRC/marcellus/Marcellus-Regular.ttf"
cp "$SRC/marcellus/OFL.txt" "$OUT/marcellus/OFL.txt"

echo "total woff2 bytes: $(cat "$OUT"/*/*.woff2 | wc -c | tr -d ' ') (budget 1200000)"
