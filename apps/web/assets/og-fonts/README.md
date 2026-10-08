# Fonts for `/og.png`

The link-preview image (`src/app/sites/[slug]/og.png/route.tsx`) is rendered with
satori + resvg from these committed files only. Rendering never fetches a font: any
grapheme these fonts cannot draw is dropped first (`fitToFonts` in `src/lib/ogFonts.ts`).

They live outside `public/` on purpose: they are server-side inputs, not web assets.
Satori reads TTF/OTF/WOFF but **not WOFF2**, so the site's web fonts (WEB-012) cannot be
reused here.

| File | Family | Covers | Size | SHA-256 | Licence |
|---|---|---|---|---|---|
| `NotoSans-Regular.ttf` | Noto Sans 400 (static, unhinted) | Latin, Latin-1, Latin Extended-A/B, Greek, Cyrillic, punctuation | 431,364 B | `f3961a9cde016d41a4879aecda1474d3a36d6bf54fa0e4643de029cc2248b0e8` | `OFL-NotoSans.txt` |
| `NotoSansTelugu-Regular.ttf` | Noto Sans Telugu 400 (static, unhinted) | Telugu | 165,212 B | `dcb86a5da09365a2d73d725e429403dca988e6d50c1b1d564579a25dbc18bd29` | `OFL-NotoSansTelugu.txt` |
| `NotoSansDevanagari-Regular.ttf` | Noto Sans Devanagari 400 (static, unhinted) | Devanagari | 184,228 B | `9c7d935139ea6a1e6ad9dbac4f6d27ece1e04bca8123c8888d00a0f9df4724cd` | `OFL-NotoSansDevanagari.txt` |

All three are © The Noto Project Authors, SIL Open Font License 1.1 (the licence files
are copied verbatim from each family's repository).

## Source

`notofonts/notofonts.github.io` at commit `47acfd3806a2b2c7f2b8a7cc95030ead55d03c21`:

```bash
SHA=47acfd3806a2b2c7f2b8a7cc95030ead55d03c21
for f in NotoSans NotoSansTelugu NotoSansDevanagari; do
  curl -sfLO "https://raw.githubusercontent.com/notofonts/notofonts.github.io/$SHA/fonts/$f/unhinted/ttf/$f-Regular.ttf"
done
curl -sfL -o OFL-NotoSans.txt           https://raw.githubusercontent.com/notofonts/latin-greek-cyrillic/main/OFL.txt
curl -sfL -o OFL-NotoSansTelugu.txt     https://raw.githubusercontent.com/notofonts/telugu/main/OFL.txt
curl -sfL -o OFL-NotoSansDevanagari.txt https://raw.githubusercontent.com/notofonts/devanagari/main/OFL.txt
shasum -a 256 *.ttf
```

Static instances are used because satori does not apply variable-font axes. Keep each
file under 5 MB (`src/lib/ogFonts.test.ts` checks this and that each has its licence).
