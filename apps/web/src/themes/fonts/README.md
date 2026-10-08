# Self-hosted theme fonts (WEB-012)

Every font the guest-site themes use is vendored here as WOFF2 and loaded with
`next/font/local` from `../fonts.ts`, so `next build` never contacts Google Fonts and works
offline or in a locked-down CI. `next/font` copies the files into `_next/static/media/` with a
content hash at build time, which is why they live beside `fonts.ts` and not in `public/` (a copy
in `public/` would be published twice).

`../fonts.test.ts` checks that `fonts.ts` does not import `next/font/google`, that every `src`
path exists and is under 5 MB, that every directory here has a licence file, and that every
`var(--font-*)` used by a theme, `globals.css` or `tailwind.config.ts` is declared.

## Families, licences, sizes

All files come from the [google/fonts](https://github.com/google/fonts) repository at commit
`2eb0b48d5f760f62e286216f0859a8c540dbc1bd` (`ofl/<family>/`). Every family is licensed under the
SIL Open Font License 1.1; the licence (with each project's copyright line) is the `OFL.txt` in
each directory. Only OFL fonts may be added here.

| Directory | Family | Variable | Source file(s) | Kept | Subset | Bytes |
|---|---|---|---|---|---|---|
| `instrument-serif` | Instrument Serif | `--font-instrument` | `InstrumentSerif-{Regular,Italic}.ttf` | 400 normal + italic | latin | 44,356 |
| `luxurious-script` | Luxurious Script | `--font-luxurious` | `LuxuriousScript-Regular.ttf` | 400 | latin | 85,740 |
| `inria-serif` | Inria Serif | `--font-inria` | `InriaSerif-{Light,Regular,Bold}{,Italic}.ttf` | 300/400/700 normal + italic | latin | 161,288 |
| `cinzel` | Cinzel | `--font-cinzel` | `Cinzel[wght].ttf` | wght 400–600 | latin | 33,888 |
| `pinyon-script` | Pinyon Script | `--font-pinyon` | `PinyonScript-Regular.ttf` | 400 | latin | 38,804 |
| `cormorant-garamond` | Cormorant Garamond | `--font-cormorant` | `CormorantGaramond[wght].ttf`, `-Italic[wght].ttf` | wght 400–600 normal + italic | latin | 115,980 |
| `marcellus` | Marcellus | `--font-marcellus` | `Marcellus-Regular.ttf` | 400, **whole font** (see below) | none | 19,364 |
| `bodoni-moda` | Bodoni Moda | `--font-bodoni` | `BodoniModa[opsz,wght].ttf`, `-Italic[opsz,wght].ttf` | wght 400–600, opsz pinned at default 11 | latin | 62,084 |
| `manrope` | Manrope | `--font-manrope` | `Manrope[wght].ttf` | wght 300–600 | latin | 22,952 |
| `jetbrains-mono` | JetBrains Mono | `--font-mono` | `JetBrainsMono[wght].ttf` | wght 400–500 | latin | 29,168 |
| `inter` | Inter | `--font-inter` | `Inter[opsz,wght].ttf` | wght 100–900, opsz pinned at default 14 | latin | 68,564 |
| `noto-sans-telugu` | Noto Sans Telugu | `--font-telugu` | `NotoSansTelugu[wdth,wght].ttf` | wght 400–600, wdth pinned at 100 | telugu | 61,992 |
| `noto-serif-telugu` | Noto Serif Telugu | `--font-telugu-serif` | `NotoSerifTelugu[wght].ttf` | wght 400–600 | telugu | 62,128 |
| `noto-sans-devanagari` | Noto Sans Devanagari | `--font-devanagari` | `NotoSansDevanagari[wdth,wght].ttf` | wght 400–600, wdth pinned at 100 | devanagari | 78,712 |
| `noto-serif-devanagari` | Noto Serif Devanagari | `--font-devanagari-serif` | `NotoSerifDevanagari[wdth,wght].ttf` | wght 400–600, wdth pinned at 100 | devanagari | 81,768 |
| | | | | | **Total** | **966,788** (budget 1,200,000) |

Weights and styles are the ones `fonts.ts` requested from `next/font/google` before WEB-012.
Axes the old config did not request (`opsz`, `wdth`) are pinned at their default, which is what
the Google Fonts API served, so rendering does not change.

**Marcellus** declares a Reserved Font Name. Under OFL section 3 a subset is a Modified Version
and may not use that name, so Marcellus ships unmodified, only rewrapped as WOFF2 (lossless).
Check the copyright line of any new family's `OFL.txt` for "Reserved Font Name" before subsetting.

Unicode ranges are Google Fonts' own subset ranges:

- **latin**: `U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD`
- **telugu**: `U+0951-0952,U+0964-0965,U+0C00-0C7F,U+1CDA,U+1CF2,U+200C-200D,U+25CC`
- **devanagari**: `U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+20A8,U+20B9,U+20F0,U+25CC,U+A830-A839,U+A8E0-A8FF`

`latin-ext` is not included: Latin family glyphs outside the range above (for example `Ł`, `ő`,
`ș`) fall back per character to the next font in the stack. Adding `latin-ext` to every Latin
family costs about 233 KB and lands right at the 1.2 MB budget.

All OpenType layout features are kept (`--layout-features='*'`), which the Indic fonts need for
conjuncts and matras and the script fonts need for their alternates.

## Rebuilding

Needs Python 3 with `fonttools` 4.66 and `brotli` (`pip install fonttools brotli`). With
`SOURCE_DATE_EPOCH` set as below the output is byte-for-byte reproducible.

```bash
SHA=2eb0b48d5f760f62e286216f0859a8c540dbc1bd
export SOURCE_DATE_EPOCH=1791471621     # that commit's date; fontTools stamps head.modified with it
SRC=$(mktemp -d)                         # google/fonts ofl/ files land here
OUT=apps/web/src/themes/fonts            # run from the repo root

fetch() {  # fetch <ofl-dir> <file>...
  local d=$1; shift; mkdir -p "$SRC/$d"
  for f in "$@" OFL.txt; do
    curl -sfL -o "$SRC/$d/$f" "https://raw.githubusercontent.com/google/fonts/$SHA/ofl/$d/$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$f")"
  done
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

LATIN="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
TELUGU="U+0951-0952,U+0964-0965,U+0C00-0C7F,U+1CDA,U+1CF2,U+200C-200D,U+25CC"
DEVANAGARI="U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+20A8,U+20B9,U+20F0,U+25CC,U+A830-A839,U+A8E0-A8FF"

build() {  # build <out-family-dir> <ofl-dir/source.ttf> <unicodes> [instancer axis limits...]
  local fam=$1 src=$2 uni=$3; shift 3
  local name; name=$(basename "$src" .ttf | sed 's/\[.*\]/-VF/')
  local in="$SRC/$src"
  mkdir -p "$OUT/$fam"
  if [ $# -gt 0 ]; then  # limit/pin variable axes first
    fonttools varLib.instancer "$in" "$@" -o "$SRC/instanced.ttf" -q; in="$SRC/instanced.ttf"
  fi
  pyftsubset "$in" --unicodes="$uni" --layout-features='*' --flavor=woff2 --output-file="$OUT/$fam/$name.woff2"
  cp "$SRC/$(dirname "$src")/OFL.txt" "$OUT/$fam/OFL.txt"
}

for s in Regular Italic; do build instrument-serif instrumentserif/InstrumentSerif-$s.ttf "$LATIN"; done
build luxurious-script luxuriousscript/LuxuriousScript-Regular.ttf "$LATIN"
for s in Light LightItalic Regular Italic Bold BoldItalic; do build inria-serif inriaserif/InriaSerif-$s.ttf "$LATIN"; done
build cinzel 'cinzel/Cinzel[wght].ttf' "$LATIN" wght=400:600
build pinyon-script pinyonscript/PinyonScript-Regular.ttf "$LATIN"
build cormorant-garamond 'cormorantgaramond/CormorantGaramond[wght].ttf' "$LATIN" wght=400:600
build cormorant-garamond 'cormorantgaramond/CormorantGaramond-Italic[wght].ttf' "$LATIN" wght=400:600
build bodoni-moda 'bodonimoda/BodoniModa[opsz,wght].ttf' "$LATIN" wght=400:600 opsz=drop
build bodoni-moda 'bodonimoda/BodoniModa-Italic[opsz,wght].ttf' "$LATIN" wght=400:600 opsz=drop
build manrope 'manrope/Manrope[wght].ttf' "$LATIN" wght=300:600
build jetbrains-mono 'jetbrainsmono/JetBrainsMono[wght].ttf' "$LATIN" wght=400:500
build inter 'inter/Inter[opsz,wght].ttf' "$LATIN" opsz=drop
build noto-sans-telugu 'notosanstelugu/NotoSansTelugu[wdth,wght].ttf' "$TELUGU" wght=400:600 wdth=drop
build noto-serif-telugu 'notoseriftelugu/NotoSerifTelugu[wght].ttf' "$TELUGU" wght=400:600
build noto-sans-devanagari 'notosansdevanagari/NotoSansDevanagari[wdth,wght].ttf' "$DEVANAGARI" wght=400:600 wdth=drop
build noto-serif-devanagari 'notoserifdevanagari/NotoSerifDevanagari[wdth,wght].ttf' "$DEVANAGARI" wght=400:600 wdth=drop

# Marcellus: Reserved Font Name, so no subsetting; lossless WOFF2 rewrap only.
mkdir -p "$OUT/marcellus"
fonttools ttLib.woff2 compress -o "$OUT/marcellus/Marcellus-Regular.woff2" "$SRC/marcellus/Marcellus-Regular.ttf"
cp "$SRC/marcellus/OFL.txt" "$OUT/marcellus/OFL.txt"

cat "$OUT"/*/*.woff2 | wc -c             # keep the total under 1,200,000 bytes
pnpm --filter @hub/web exec vitest run src/themes/fonts.test.ts
```

## Adding or changing a family

1. Confirm the family is OFL (`ofl/` in google/fonts) and check its `OFL.txt` for a Reserved Font Name.
2. Add a `fetch` and `build` line above; keep only the weights/styles a theme uses.
3. Declare it in `../fonts.ts` with `localFont({ src: [...], variable: "--font-x", display: "swap", preload: false })`
   (literal arguments only) and append `.variable` to `fontVariableClasses`.
4. Update the table above and run the test.
