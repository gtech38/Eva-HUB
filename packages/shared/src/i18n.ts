export const LOCALES = ["en", "te", "hi"] as const;
export type Locale = (typeof LOCALES)[number];

/** Host-authored text: { en: "...", te?: "...", hi?: "..." } */
export type LocalizedText = Partial<Record<Locale, string>>;

export function t(text: LocalizedText | string | null | undefined, locale: Locale, fallback: Locale = "en"): string {
  if (!text) return "";
  if (typeof text === "string") return text;
  return text[locale] ?? text[fallback] ?? text.en ?? Object.values(text).find(Boolean) ?? "";
}

export function isLocale(x: string | undefined | null): x is Locale {
  return !!x && (LOCALES as readonly string[]).includes(x);
}

export const LOCALE_NAMES: Record<Locale, string> = { en: "English", te: "తెలుగు", hi: "हिन्दी" };

/**
 * UI chrome strings. Small on purpose for the POC; move to next-intl message
 * files when the catalogs grow.
 */
export const UI = {
  signIn: { en: "Sign in", te: "సైన్ ఇన్", hi: "साइन इन करें" },
  signInHelp: { en: "Enter the email or phone your invitation was sent to.", te: "మీ ఆహ్వానం పంపిన ఇమెయిల్ లేదా ఫోన్ నంబర్ నమోదు చేయండి.", hi: "वह ईमेल या फ़ोन दर्ज करें जिस पर आपका निमंत्रण भेजा गया था।" },
  signInSent: { en: "If you're on the guest list, we've sent you a link.", te: "మీరు అతిథుల జాబితాలో ఉంటే, మేము మీకు లింక్ పంపాము.", hi: "यदि आप अतिथि सूची में हैं, तो हमने आपको एक लिंक भेजा है।" },
  inviteExpired: { en: "This link has expired", te: "ఈ లింక్ గడువు ముగిసింది", hi: "इस लिंक की समय-सीमा समाप्त हो गई है" },
  tooManyRequests: {
    en: "Too many requests. Please wait a few minutes and try again.",
    te: "చాలా ఎక్కువ అభ్యర్థనలు వచ్చాయి. దయచేసి కొన్ని నిమిషాలు ఆగి మళ్ళీ ప్రయత్నించండి.",
    hi: "बहुत अधिक अनुरोध। कृपया कुछ मिनट रुककर फिर से प्रयास करें।",
  },
  home: { en: "Home", te: "హోమ్", hi: "होम" },
  about: { en: "Our Story", te: "మా కథ", hi: "हमारी कहानी" },
  schedule: { en: "Schedule", te: "షెడ్యూల్", hi: "कार्यक्रम" },
  travel: { en: "Travel & Stay", te: "ప్రయాణం", hi: "यात्रा" },
  faq: { en: "FAQ", te: "ప్రశ్నలు", hi: "सवाल" },
  registry: { en: "Registry", te: "రిజిస్ట్రీ", hi: "रजिस्ट्री" },
  gallery: { en: "Gallery", te: "గ్యాలరీ", hi: "गैलरी" },
  rsvp: { en: "RSVP", te: "RSVP", hi: "RSVP" },
  myPhotos: { en: "My photos", te: "నా ఫోటోలు", hi: "मेरी तस्वीरें" },
  findMe: { en: "Find me with a selfie", te: "సెల్ఫీతో నన్ను కనుగొనండి", hi: "सेल्फ़ी से मुझे खोजें" },
  attending: { en: "Attending", te: "హాజరవుతున్నాను", hi: "आ रहे हैं" },
  declined: { en: "Can't make it", te: "రాలేను", hi: "नहीं आ सकते" },
  pending: { en: "No response yet", te: "ఇంకా స్పందన లేదు", hi: "अभी तक कोई उत्तर नहीं" },
  meal: { en: "Meal", te: "భోజనం", hi: "भोजन" },
  save: { en: "Save", te: "సేవ్", hi: "सहेजें" },
  saved: { en: "Saved", te: "సేవ్ అయింది", hi: "सहेजा गया" },
  signOut: { en: "Sign out", te: "సైన్ అవుట్", hi: "साइन आउट" },
  notYou: { en: "Not you?", te: "మీరు కాదా?", hi: "आप नहीं हैं?" },
  photographyBy: { en: "Photography by", te: "ఫోటోగ్రఫీ", hi: "फ़ोटोग्राफ़ी" },
} satisfies Record<string, LocalizedText>;

export type UIKey = keyof typeof UI;
export const ui = (key: UIKey, locale: Locale) => t(UI[key], locale);
