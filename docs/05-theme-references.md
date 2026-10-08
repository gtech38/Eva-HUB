# 05 — Theme references

Six templates: three for weddings, three for other events. Every theme reads the event's `kind` (`Event.kind`) to choose its copy, so a Luxury theme on a 50th birthday never says "are getting married" (see `apps/web/src/lib/eventCopy.ts`).

Researched 2026-10-07. For each of the three templates one live reference was chosen; its palette, type and layout rhythm were measured from the rendered page (computed styles) and re-implemented in `apps/web/src/themes/`. We borrow the *style language* (colours, typography, spacing, ornament vocabulary), never the reference's code or imagery.

| Theme | Reference | Why it was chosen over the alternatives |
|---|---|---|
| **Luxury** | Velvet Promise (Framer) — https://velvetpromise.framer.website/ | Burgundy velvet + cream + antique gold reads as "luxury" far better than the black/gold we started with, and the drop-cap script initials give the names a signature. Alternatives: Wix "Editorial Wedding" (black/white, too austere), Riley & Grey (fashion-forward, no single palette). |
| **High-Class Romantic** | Vow and Bloom (Framer) — https://vow-and-bloom.framer.website/ | Warm ivory, soft charcoal, dusty rose and sage with tight-tracked serif headings and falling petals: romantic without being sugary. Alternatives: Fleur (Playfair, generic), Soraya (bold Gambarino display, more fashion than romance), Vows & Blooms (grey minimal, not romantic). |
| **Elegant Hindu Traditional** | Jashn (Framer) — https://shaaditemplate.framer.website/ | Cream paper with deep maroon, gold floral line ornaments, spaced uppercase serif names and a calligraphic script accent; split hero (image panel + text panel). Reads as South Asian celebration without clip-art. Alternatives: Janeman (modern brown/photographic, little tradition), Shaadi (watercolour florals + gold frame — we borrow its thin gold double frame). |

## Measured tokens

### Luxury ← Velvet Promise

| Token | Value | Source |
|---|---|---|
| Burgundy (bg, hero) | `#580B1B`, deep `#460101` | `rgb(88,11,27)`, `rgb(70,1,1)` |
| Cream (text on burgundy, section bg) | `#F7EAD7` | `rgb(247,234,215)` |
| Pale gold | `#E4E2B8` | `rgb(228,226,184)` |
| Antique gold accent | `#C9A961` | gold frame/rings (sampled) |
| Display | Instrument Serif 400, 46–120px, normal tracking | h2 46px |
| Initial letters | Luxurious Script | drop-cap first letter of each name |
| Eyebrow | Inter 400 uppercase, ~0.3em tracking | "ARE GETTING MARRIED" |
| Body | Instrument Serif 24px on hero; Inter elsewhere | p 24px |
| Layout | Full-bleed burgundy hero with velvet texture, gold-framed photo, cream content band below; pill RSVP button in cream | |

### Romantic ← Vow and Bloom

| Token | Value | Source |
|---|---|---|
| Ivory (bg) | `#F6F1E8`; surface `#FFF9F5`, `#F2ECE4` | `rgb(246,241,232)` etc. |
| Soft charcoal (text) | `#2B2926`; muted `#756E67` | `rgb(43,41,38)`, `rgb(117,110,103)` |
| Dusty rose (accent) | `#B88792` | `rgb(184,135,146)` |
| Sage (secondary) | `#7A8068` | `rgb(122,128,104)` |
| Lines | `#D8D0C7`, `#E9E2DB` | |
| Display | Inria Serif 400, 46–52px, letter-spacing −0.02em | h2 52px, −1.04px |
| Body | Inter | |
| Eyebrow | uppercase, wide tracking, tiny | "WE'RE GETTING MARRIED" |
| Motion | falling petals over the hero | animated blobs in dusty rose |
| Layout | Centered, airy; pill buttons in rose; large hero image with pale sky | |

### Hindu Traditional ← Jashn

| Token | Value | Source |
|---|---|---|
| Cream paper (bg) | `#F6F4EE`; surface `#FFFCF7` | `rgb(246,244,238)`, `rgb(255,252,247)` |
| Deep maroon (headings, panel) | `#450000`; `#58181C` | `rgb(69,0,0)`, `rgb(88,24,28)` |
| Gold ornament | `#B8923E` (sampled from floral dividers) | |
| Text | `#212121`; muted `#4E4E4E` | |
| Names | spaced uppercase display serif (reference: Aqala Display → we use **Cinzel**) | |
| Script accent | calligraphic (reference: Qaskin → we use **Pinyon Script**) | "Married!" |
| Body | Garamond-style serif (reference: Times → we use **Cormorant Garamond**) | |
| Ornament | thin gold floral line dividers above/below headings; thin gold double frame (from Shaadi) | |
| Layout | Split hero: deep-red image panel left, cream text panel right; single column below | |

## Font substitutions (all Google Fonts, free for commercial use)

| Reference font | Licence problem | Used instead |
|---|---|---|
| Aqala Display FREE | personal-use licence | Cinzel |
| Qaskin (Personal Use) | personal-use licence | Pinyon Script |
| Derivia, Gambarino | not on Google Fonts | not needed |
| Instrument Serif, Luxurious Script, Inria Serif, Inter, Cormorant Garamond | OFL | used as-is |

Telugu and Devanagari fallbacks (Noto) stay in every stack; the display fonts above have no Indic glyphs.

## Not borrowed
Reference photography, illustrations, copy, animations code, and Framer-specific layouts. Petal and ornament effects are our own CSS.

## Non-wedding themes (added 2026-10-08)

| Theme | For | Reference | Style language |
|---|---|---|---|
| **Nursery Sage** (`NURSERY_SAGE`) | Baby showers, seemantham, naming ceremonies | No single live reference; synthesised from the "luxury sage green baby shower" idiom (sage + cream + champagne gold, serif italics, botanical line art, crescent moon) | Sage `#8A9A7B`, cream `#FBF8F2`, champagne `#C9B280`; Cormorant Garamond italic display, Inter body; sprig and moon SVG ornaments; soft 18px radii, pill buttons |
| **Telugu Traditional** (`TELUGU_TRADITIONAL`) | Gruhapravesam, annaprasana, upanayanam, half-saree, Satyanarayana vratam | Traditional Telugu invitation vocabulary rather than a web template: turmeric, kumkum, mango-leaf toran, kalasam, "శుభం" | Cream `#FFF8E7`, kumkum `#B3261E`, turmeric `#E0A526`, mango leaf `#3F6B3E`; Marcellus + **Noto Serif Telugu** display (Telugu is first-class here, not a fallback), Cormorant body; toran garland along the top, kalasam SVG, turmeric double frame |
| **Midnight Gala** (`MIDNIGHT_GALA`) | Parties, milestone birthdays, launches, galas | Vervee (Framer) — https://vervee-template.framer.website/ | Near-black `#050505`, bone `#F5F0E8`, champagne gold `#C49A25` (measured: `rgb(5,5,5)`, `rgb(245,240,232)`, `rgb(196,154,37)`); reference uses Gambetta uppercase serif (−0.02em) + Manrope + JetBrains Mono → we use **Bodoni Moda** uppercase + Manrope + JetBrains Mono for eyebrows; left-aligned hero, gold radial glow |

Alternatives looked at for the gala: The Gilded (Playfair + Cormorant on bone, "institutional brutalist" — handsome but reads as a wedding), Champagne (invitation-card format). Vervee's dark editorial register was the clear fit for "high end, clean, not a wedding".

### Kind-aware copy
`EventKind` ∈ WEDDING, ENGAGEMENT, BABY_SHOWER, BIRTHDAY, ANNIVERSARY, CEREMONY, PARTY, CORPORATE, OTHER. `eventCopy(kind, locale)` supplies `eyebrow` ("are getting married" / "a little one is on the way" / "an evening to remember"), `accent` ("Married!" / "Oh, baby" / "Blessings"), `invite`, and `signoff` in en/te/hi; `hostsPageLabel` renames the Wedding Party page to Hosts/Family. Any theme can be paired with any kind; the admin shows which pairings each theme suits.
