/**
 * Renders an OG card to PNG with satori (layout, shaping, text to paths) and resvg (raster).
 * Network-free by construction: fonts come from committed files, uncovered graphemes are
 * removed before layout, satori's dynamic-asset hook returns nothing (no Google Fonts, no
 * emoji CDN) and resvg loads no system fonts because satori has already outlined the text.
 *
 * Text stays with satori on purpose: resvg-js 2.6 mis-advances Devanagari clusters
 * (विवाह overlaps) when it shapes <text> itself; satori's outlines match browser output
 * for Telugu, Devanagari and Latin-Ext with these fonts.
 */
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { OgCardImage, type OgCard } from "./ogCard";
import { fitToFonts, type OgFonts } from "./ogFonts";
import { OG_IMAGE_SIZE } from "./siteMetadata";

const noRemoteAssets = async () => [];

export async function renderOgPng(card: OgCard, { fonts, covers }: OgFonts): Promise<Uint8Array> {
  const drawable = { ...card, title: fitToFonts(card.title, covers), monogram: fitToFonts(card.monogram, covers) };
  const svg = await satori(<OgCardImage {...drawable} />, {
    ...OG_IMAGE_SIZE,
    fonts,
    loadAdditionalAsset: noRemoteAssets,
  });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: OG_IMAGE_SIZE.width }, font: { loadSystemFonts: false } }).render().asPng();
  return new Uint8Array(png);
}
