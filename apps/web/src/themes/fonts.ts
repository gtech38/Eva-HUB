/**
 * All theme fonts are declared once (next/font requires module-scope constants) and
 * exposed as CSS variables on <html>. Each theme's tokens pick which variables feed
 * --font-display / --font-body / --font-script. Noto Telugu + Devanagari are always in
 * the fallback stack because Telugu glyphs are taller and longer than Latin.
 */
import {
  Cormorant_Garamond,
  Playfair_Display,
  Great_Vibes,
  Inter,
  Lora,
  Noto_Sans_Telugu,
  Noto_Sans_Devanagari,
  Noto_Serif_Devanagari,
} from "next/font/google";

export const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["300", "400", "500", "600"], style: ["normal", "italic"], variable: "--font-cormorant", display: "swap", preload: false });
export const playfair = Playfair_Display({ subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--font-playfair", display: "swap", preload: false });
export const greatVibes = Great_Vibes({ subsets: ["latin"], weight: "400", variable: "--font-great-vibes", display: "swap", preload: false });
export const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap", preload: false });
export const lora = Lora({ subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--font-lora", display: "swap", preload: false });
export const notoTelugu = Noto_Sans_Telugu({ subsets: ["telugu"], weight: ["400", "600"], variable: "--font-telugu", display: "swap", preload: false });
export const notoDevanagari = Noto_Sans_Devanagari({ subsets: ["devanagari"], weight: ["400", "600"], variable: "--font-devanagari", display: "swap", preload: false });
export const notoSerifDevanagari = Noto_Serif_Devanagari({ subsets: ["devanagari"], weight: ["400", "600"], variable: "--font-devanagari-serif", display: "swap", preload: false });

export const fontVariableClasses = [
  cormorant.variable,
  playfair.variable,
  greatVibes.variable,
  inter.variable,
  lora.variable,
  notoTelugu.variable,
  notoDevanagari.variable,
  notoSerifDevanagari.variable,
].join(" ");
