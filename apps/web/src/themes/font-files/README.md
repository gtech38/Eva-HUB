# Self-hosted theme fonts (WEB-012)

Every font the guest-site themes use is vendored here as WOFF2 and loaded with
`next/font/local` from `../fonts.ts`, so `next build` never contacts Google Fonts and works
offline or in a locked-down CI. `next/font` copies the files into `_next/static/media/` with a
content hash at build time, which is why they live beside `fonts.ts` and not in `public/` (a copy
in `public/` would be published twice).

Two tests guard this directory:

- `../fonts.test.ts` checks that no file under `apps/` imports `next/font/google` or
  `@next/font/google`, that every `src` path in `fonts.ts` exists, that each family keeps the
  weights and styles the themes used before WEB-012, and that every `var(--font-*)` used by a
  theme, `globals.css` or `tailwind.config.ts` is declared.
- `../fontFiles.test.ts` checks the files themselves: total size within the 1.2 MB budget, a full
  OFL text per family, a Reserved Font Name allow-list, licence name IDs 13/14 inside every file,
  latin-ext and arrow glyph coverage, and the pins in `build.sh`.

## Families, licences, sizes

All files come from the [google/fonts](https://github.com/google/fonts) repository at commit
`2eb0b48d5f760f62e286216f0859a8c540dbc1bd` (`ofl/<family>/`). Every family is licensed under the
SIL Open Font License 1.1; the licence (with each project's copyright line) is the `OFL.txt` in
each directory. Only OFL fonts may be added here.

| Directory | Family | Variable | Source file(s) | Kept | Subset | Bytes |
|---|---|---|---|---|---|---|
| `instrument-serif` | Instrument Serif | `--font-instrument` | `InstrumentSerif-{Regular,Italic}.ttf` | 400 normal + italic | latin + latin-ext | 51,908 |
| `luxurious-script` | Luxurious Script | `--font-luxurious` | `LuxuriousScript-Regular.ttf` | 400 | latin + latin-ext | 111,048 |
| `inria-serif` | Inria Serif | `--font-inria` | `InriaSerif-{Light,Regular,Bold}{,Italic}.ttf` | 300/400/700 normal + italic | latin + latin-ext | 188,036 |
| `cinzel` | Cinzel | `--font-cinzel` | `Cinzel[wght].ttf` | wght 400–600 | latin + latin-ext | 40,352 |
| `pinyon-script` | Pinyon Script | `--font-pinyon` | `PinyonScript-Regular.ttf` | 400 | latin + latin-ext | 50,588 |
| `cormorant-garamond` | Cormorant Garamond | `--font-cormorant` | `CormorantGaramond[wght].ttf`, `-Italic[wght].ttf` | wght 400–600 normal + italic | latin + latin-ext | 186,528 |
| `marcellus` | Marcellus | `--font-marcellus` | `Marcellus-Regular.ttf` | 400, **whole font** (see below) | none | 19,364 |
| `bodoni-moda` | Bodoni Moda | `--font-bodoni` | `BodoniModa[opsz,wght].ttf`, `-Italic[opsz,wght].ttf` | wght 400–600, opsz pinned at default 11 | latin + latin-ext | 72,568 |
| `manrope` | Manrope | `--font-manrope` | `Manrope[wght].ttf` | wght 300–600 | latin + latin-ext | 31,408 |
| `jetbrains-mono` | JetBrains Mono | `--font-mono` | `JetBrainsMono[wght].ttf` | wght 400–500 | latin + latin-ext | 33,588 |
| `inter` | Inter | `--font-inter` | `Inter[opsz,wght].ttf` | wght 100–900, opsz pinned at default 14 | latin only (see below) | 68,788 |
| `noto-sans-telugu` | Noto Sans Telugu | `--font-telugu` | `NotoSansTelugu[wdth,wght].ttf` | wght 400–600, wdth pinned at 100 | telugu | 62,140 |
| `noto-serif-telugu` | Noto Serif Telugu | `--font-telugu-serif` | `NotoSerifTelugu[wght].ttf` | wght 400–600 | telugu | 62,324 |
| `noto-sans-devanagari` | Noto Sans Devanagari | `--font-devanagari` | `NotoSansDevanagari[wdth,wght].ttf` | wght 400–600, wdth pinned at 100 | devanagari | 78,936 |
| `noto-serif-devanagari` | Noto Serif Devanagari | `--font-devanagari-serif` | `NotoSerifDevanagari[wdth,wght].ttf` | wght 400–600, wdth pinned at 100 | devanagari | 81,912 |
| | | | | | **Total** | **1,139,488** (budget 1,200,000) |

Weights and styles are the ones `fonts.ts` requested from `next/font/google` before WEB-012.
Axes the old config did not request (`opsz`, `wdth`) are pinned at their default, which is what
the Google Fonts API served, so rendering does not change.

**Marcellus** declares a Reserved Font Name. Under OFL section 3 a subset is a Modified Version
and may not use that name, so Marcellus ships unmodified, only rewrapped as WOFF2 (lossless).
`fontFiles.test.ts` keeps an allow-list of families whose `OFL.txt` declares a Reserved Font Name;
adding such a family fails the test until it is listed here and in the script as "ships whole".

**Inter** stays on plain `latin` so the payload fits the budget: with `latin-ext` Inter grows from
68,788 to 135,692 bytes and the total to 1,206,392, which is 6,392 bytes over. Latin-ext
characters in Inter text (for example `Ł`, `ő`) fall back per character to the next font in the
stack.

Unicode ranges are Google Fonts' own subset ranges, with the arrows widened from
`U+2191,U+2193` to `U+2190-2193`:

- **latin**: `U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD`
- **latin-ext**: `U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF`
- **telugu**: `U+0951-0952,U+0964-0965,U+0C00-0C7F,U+1CDA,U+1CF2,U+200C-200D,U+25CC`
- **devanagari**: `U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+20A8,U+20B9,U+20F0,U+25CC,U+A830-A839,U+A8E0-A8FF`

A range only adds glyphs the source font has: Cinzel, Bodoni Moda, Instrument Serif, Luxurious
Script and Pinyon Script have no arrows, so they gain none.

All OpenType layout features are kept (`--layout-features='*'`), which the Indic fonts need for
conjuncts and matras and the script fonts need for their alternates. Name IDs 13 and 14 (licence
description and URL) are kept next to the pyftsubset defaults so each file carries its licence
pointer.

## Rebuilding

```bash
bash apps/web/src/themes/font-files/build.sh     # from the repo root; ~2 minutes
```

The script is self-contained: it creates a throwaway venv with `fonttools==4.66.1` and
`brotli==1.2.0`, downloads the source TTFs and licences from the pinned google/fonts commit,
limits or pins variable axes with `fonttools varLib.instancer`, subsets with
`fonttools subset --no-harfbuzz-repacker`, and rewrites every `*.woff2` and `OFL.txt` here. The
pins, the commit, `SOURCE_DATE_EPOCH` (the commit's date, stamped into `head.modified`) and the
pure-Python GPOS/GSUB serializer make the output byte-for-byte reproducible; running it twice
produces an empty `diff -r`. It ends by printing the total size.

## Adding or changing a family

1. Confirm the family is OFL (`ofl/` in google/fonts) and check its `OFL.txt` for a Reserved Font Name.
2. Add a `fetch` and `build` line to `build.sh`; keep only the weights/styles a theme uses.
3. Declare it in `../fonts.ts` with `localFont({ src: [...], variable: "--font-x", display: "swap", preload: false })`
   (literal arguments only), append `.variable` to `fontVariableClasses`, and add its weights and
   styles to `EXPECTED_FACES` in `../fonts.test.ts`.
4. Run the build script, update the table above, and run `pnpm --filter @hub/web test`.
