import { t, ui, type Locale, type LocalizedText } from "@hub/shared/i18n";
import type { GalleryStrings } from "@/components/gallery/PhotoGrid";

const S = {
  download: { en: "Download", te: "డౌన్‌లోడ్", hi: "डाउनलोड" },
  favorite: { en: "Add to favorites", te: "ఇష్టమైనవిగా గుర్తించండి", hi: "पसंदीदा में जोड़ें" },
  unfavorite: { en: "Remove from favorites", te: "ఇష్టమైనవి నుండి తీసివేయండి", hi: "पसंदीदा से हटाएँ" },
  close: { en: "Close", te: "మూసివేయి", hi: "बंद करें" },
  prev: { en: "Previous", te: "మునుపటి", hi: "पिछला" },
  next: { en: "Next", te: "తదుపరి", hi: "अगला" },
  watermarked: { en: "preview", te: "ప్రివ్యూ", hi: "पूर्वावलोकन" },
  empty: { en: "No photos yet", te: "ఇంకా ఫోటోలు లేవు", hi: "अभी तक कोई तस्वीर नहीं" },
  emptyBody: { en: "Photos will appear here once the studio uploads them.", te: "స్టూడియో అప్‌లోడ్ చేసిన తర్వాత ఫోటోలు ఇక్కడ కనిపిస్తాయి.", hi: "स्टूडियो द्वारा अपलोड करने के बाद तस्वीरें यहाँ दिखाई देंगी।" },
  albums: { en: "Albums", te: "ఆల్బమ్‌లు", hi: "एल्बम" },
  allPhotos: { en: "All photos", te: "అన్ని ఫోటోలు", hi: "सभी तस्वीरें" },
  photos: { en: "photos", te: "ఫోటోలు", hi: "तस्वीरें" },
  favorites: { en: "Favorites", te: "ఇష్టమైనవి", hi: "पसंदीदा" },
  backToGallery: { en: "All albums", te: "అన్ని ఆల్బమ్‌లు", hi: "सभी एल्बम" },
  hostsOnly: { en: "Hosts only", te: "హోస్ట్‌లకు మాత్రమే", hi: "केवल मेज़बान" },
  hidden: { en: "Hidden", te: "దాచబడింది", hi: "छिपा हुआ" },
  loadingMore: { en: "Loading more photos…", te: "మరిన్ని ఫోటోలు లోడ్ అవుతున్నాయి…", hi: "और तस्वीरें लोड हो रही हैं…" },
  loadFailed: { en: "Couldn't load more photos.", te: "మరిన్ని ఫోటోలను లోడ్ చేయలేకపోయాము.", hi: "और तस्वीरें लोड नहीं हो सकीं।" },
  retry: { en: "Try again", te: "మళ్ళీ ప్రయత్నించండి", hi: "फिर से कोशिश करें" },
} satisfies Record<string, LocalizedText>;

export type GalleryPageStrings = GalleryStrings & { [K in keyof typeof S]: string } & { myPhotos: string; findMe: string; gallery: string };

export function galleryStrings(locale: Locale): GalleryPageStrings {
  const out = {} as Record<keyof typeof S, string>;
  for (const k of Object.keys(S) as Array<keyof typeof S>) out[k] = t(S[k], locale);
  return { ...out, myPhotos: ui("myPhotos", locale), findMe: ui("findMe", locale), gallery: ui("gallery", locale) };
}
