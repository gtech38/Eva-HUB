/**
 * All theme fonts are declared once (next/font requires module-scope constants and literal
 * arguments) and exposed as CSS variables on <html>. Each theme's tokens pick which variables
 * feed --font-display / --font-body / --font-script. Noto Telugu + Devanagari are always in
 * the fallback stack because Telugu glyphs are taller and longer than Latin.
 *
 * Self-hosted (WEB-012): the WOFF2 files live in ./fonts/<family>/ with their OFL licence;
 * how they were built (source commit, axis ranges, subsets) is in ./fonts/README.md. The build
 * never contacts Google. Latin families are subset to Google's "latin" range, the Noto families
 * to their script. Variable files keep only the weight range the themes use; `fonts.test.ts`
 * checks every `var(--font-*)` a theme references is declared here.
 *
 * Font choices follow docs/05-theme-references.md:
 *   Luxury              → Instrument Serif + Luxurious Script + Inter     (ref: Velvet Promise)
 *   Romantic            → Inria Serif + Inter                              (ref: Vow and Bloom)
 *   Hindu Traditional   → Cinzel + Pinyon Script + Cormorant Garamond      (ref: Jashn)
 *   Nursery Sage        → Cormorant Garamond italic + Inter                (baby shower)
 *   Telugu Traditional  → Marcellus + Noto Serif Telugu + Cormorant        (ceremonies)
 *   Midnight Gala       → Bodoni Moda + Manrope + JetBrains Mono           (ref: Vervee)
 *
 * adjustFontFallback mirrors what next/font/google did: Times New Roman metrics for serif
 * families, Arial for everything else.
 */
import localFont from "next/font/local";

export const instrumentSerif = localFont({
  src: [
    { path: "./fonts/instrument-serif/InstrumentSerif-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/instrument-serif/InstrumentSerif-Italic.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-instrument",
  adjustFontFallback: "Times New Roman",
  display: "swap",
  preload: false,
});

export const luxuriousScript = localFont({
  src: [{ path: "./fonts/luxurious-script/LuxuriousScript-Regular.woff2", weight: "400", style: "normal" }],
  variable: "--font-luxurious",
  display: "swap",
  preload: false,
});

export const inriaSerif = localFont({
  src: [
    { path: "./fonts/inria-serif/InriaSerif-Light.woff2", weight: "300", style: "normal" },
    { path: "./fonts/inria-serif/InriaSerif-LightItalic.woff2", weight: "300", style: "italic" },
    { path: "./fonts/inria-serif/InriaSerif-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/inria-serif/InriaSerif-Italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/inria-serif/InriaSerif-Bold.woff2", weight: "700", style: "normal" },
    { path: "./fonts/inria-serif/InriaSerif-BoldItalic.woff2", weight: "700", style: "italic" },
  ],
  variable: "--font-inria",
  adjustFontFallback: "Times New Roman",
  display: "swap",
  preload: false,
});

export const cinzel = localFont({
  src: [{ path: "./fonts/cinzel/Cinzel-VF.woff2", weight: "400 600", style: "normal" }],
  variable: "--font-cinzel",
  adjustFontFallback: "Times New Roman",
  display: "swap",
  preload: false,
});

export const pinyonScript = localFont({
  src: [{ path: "./fonts/pinyon-script/PinyonScript-Regular.woff2", weight: "400", style: "normal" }],
  variable: "--font-pinyon",
  display: "swap",
  preload: false,
});

export const cormorant = localFont({
  src: [
    { path: "./fonts/cormorant-garamond/CormorantGaramond-VF.woff2", weight: "400 600", style: "normal" },
    { path: "./fonts/cormorant-garamond/CormorantGaramond-Italic-VF.woff2", weight: "400 600", style: "italic" },
  ],
  variable: "--font-cormorant",
  adjustFontFallback: "Times New Roman",
  display: "swap",
  preload: false,
});

export const marcellus = localFont({
  src: [{ path: "./fonts/marcellus/Marcellus-Regular.woff2", weight: "400", style: "normal" }],
  variable: "--font-marcellus",
  adjustFontFallback: "Times New Roman",
  display: "swap",
  preload: false,
});

export const bodoni = localFont({
  src: [
    { path: "./fonts/bodoni-moda/BodoniModa-VF.woff2", weight: "400 600", style: "normal" },
    { path: "./fonts/bodoni-moda/BodoniModa-Italic-VF.woff2", weight: "400 600", style: "italic" },
  ],
  variable: "--font-bodoni",
  adjustFontFallback: "Times New Roman",
  display: "swap",
  preload: false,
});

export const manrope = localFont({
  src: [{ path: "./fonts/manrope/Manrope-VF.woff2", weight: "300 600", style: "normal" }],
  variable: "--font-manrope",
  display: "swap",
  preload: false,
});

export const jetbrainsMono = localFont({
  src: [{ path: "./fonts/jetbrains-mono/JetBrainsMono-VF.woff2", weight: "400 500", style: "normal" }],
  variable: "--font-mono",
  display: "swap",
  preload: false,
});

export const inter = localFont({
  src: [{ path: "./fonts/inter/Inter-VF.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-inter",
  display: "swap",
  preload: false,
});

export const notoTelugu = localFont({
  src: [{ path: "./fonts/noto-sans-telugu/NotoSansTelugu-VF.woff2", weight: "400 600", style: "normal" }],
  variable: "--font-telugu",
  display: "swap",
  preload: false,
});

export const notoSerifTelugu = localFont({
  src: [{ path: "./fonts/noto-serif-telugu/NotoSerifTelugu-VF.woff2", weight: "400 600", style: "normal" }],
  variable: "--font-telugu-serif",
  adjustFontFallback: "Times New Roman",
  display: "swap",
  preload: false,
});

export const notoDevanagari = localFont({
  src: [{ path: "./fonts/noto-sans-devanagari/NotoSansDevanagari-VF.woff2", weight: "400 600", style: "normal" }],
  variable: "--font-devanagari",
  display: "swap",
  preload: false,
});

export const notoSerifDevanagari = localFont({
  src: [{ path: "./fonts/noto-serif-devanagari/NotoSerifDevanagari-VF.woff2", weight: "400 600", style: "normal" }],
  variable: "--font-devanagari-serif",
  adjustFontFallback: "Times New Roman",
  display: "swap",
  preload: false,
});

export const fontVariableClasses = [
  instrumentSerif.variable,
  luxuriousScript.variable,
  inriaSerif.variable,
  cinzel.variable,
  pinyonScript.variable,
  cormorant.variable,
  marcellus.variable,
  bodoni.variable,
  manrope.variable,
  jetbrainsMono.variable,
  inter.variable,
  notoTelugu.variable,
  notoSerifTelugu.variable,
  notoDevanagari.variable,
  notoSerifDevanagari.variable,
].join(" ");
