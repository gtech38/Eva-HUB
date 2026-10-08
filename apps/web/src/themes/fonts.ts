/**
 * All theme fonts are declared once (next/font requires module-scope constants) and
 * exposed as CSS variables on <html>. Each theme's tokens pick which variables feed
 * --font-display / --font-body / --font-script. Noto Telugu + Devanagari are always in
 * the fallback stack because Telugu glyphs are taller and longer than Latin.
 *
 * Font choices follow docs/05-theme-references.md:
 *   Luxury              → Instrument Serif + Luxurious Script + Inter     (ref: Velvet Promise)
 *   Romantic            → Inria Serif + Inter                              (ref: Vow and Bloom)
 *   Hindu Traditional   → Cinzel + Pinyon Script + Cormorant Garamond      (ref: Jashn)
 *   Nursery Sage        → Cormorant Garamond italic + Inter                (baby shower)
 *   Telugu Traditional  → Marcellus + Noto Serif Telugu + Cormorant        (ceremonies)
 *   Midnight Gala       → Bodoni Moda + Manrope + JetBrains Mono           (ref: Vervee)
 */
import {
  Instrument_Serif,
  Luxurious_Script,
  Inria_Serif,
  Cinzel,
  Pinyon_Script,
  Cormorant_Garamond,
  Marcellus,
  Bodoni_Moda,
  Manrope,
  JetBrains_Mono,
  Inter,
  Noto_Sans_Telugu,
  Noto_Serif_Telugu,
  Noto_Sans_Devanagari,
  Noto_Serif_Devanagari,
} from "next/font/google";

export const instrumentSerif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-instrument", display: "swap", preload: false });
export const luxuriousScript = Luxurious_Script({ subsets: ["latin"], weight: "400", variable: "--font-luxurious", display: "swap", preload: false });
export const inriaSerif = Inria_Serif({ subsets: ["latin"], weight: ["300", "400", "700"], style: ["normal", "italic"], variable: "--font-inria", display: "swap", preload: false });
export const cinzel = Cinzel({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-cinzel", display: "swap", preload: false });
export const pinyonScript = Pinyon_Script({ subsets: ["latin"], weight: "400", variable: "--font-pinyon", display: "swap", preload: false });
export const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--font-cormorant", display: "swap", preload: false });
export const marcellus = Marcellus({ subsets: ["latin"], weight: "400", variable: "--font-marcellus", display: "swap", preload: false });
export const bodoni = Bodoni_Moda({ subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--font-bodoni", display: "swap", preload: false });
export const manrope = Manrope({ subsets: ["latin"], weight: ["300", "400", "500", "600"], variable: "--font-manrope", display: "swap", preload: false });
export const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap", preload: false });
export const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap", preload: false });
export const notoTelugu = Noto_Sans_Telugu({ subsets: ["telugu"], weight: ["400", "600"], variable: "--font-telugu", display: "swap", preload: false });
export const notoSerifTelugu = Noto_Serif_Telugu({ subsets: ["telugu"], weight: ["400", "600"], variable: "--font-telugu-serif", display: "swap", preload: false });
export const notoDevanagari = Noto_Sans_Devanagari({ subsets: ["devanagari"], weight: ["400", "600"], variable: "--font-devanagari", display: "swap", preload: false });
export const notoSerifDevanagari = Noto_Serif_Devanagari({ subsets: ["devanagari"], weight: ["400", "600"], variable: "--font-devanagari-serif", display: "swap", preload: false });

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
