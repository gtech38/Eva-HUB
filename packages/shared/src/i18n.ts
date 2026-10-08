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
  temporarilyUnavailable: {
    en: "Something went wrong on our side. Please try again in a few minutes.",
    te: "మా వైపు ఏదో సమస్య వచ్చింది. దయచేసి కొన్ని నిమిషాల తర్వాత మళ్ళీ ప్రయత్నించండి.",
    hi: "हमारी ओर से कुछ गड़बड़ हो गई। कृपया कुछ मिनट बाद फिर से प्रयास करें।",
  },
  home: { en: "Home", te: "హోమ్", hi: "होम" },
  about: { en: "Our Story", te: "మా కథ", hi: "हमारी कहानी" },
  schedule: { en: "Schedule", te: "షెడ్యూల్", hi: "कार्यक्रम" },
  travel: { en: "Travel & Stay", te: "ప్రయాణం", hi: "यात्रा" },
  faq: { en: "FAQ", te: "ప్రశ్నలు", hi: "सवाल" },
  registry: { en: "Registry", te: "రిజిస్ట్రీ", hi: "रजिस्ट्री" },
  party: { en: "Wedding Party", te: "పెళ్లి బృందం", hi: "शादी की टोली" },
  markPurchased: { en: "Mark as purchased", te: "కొన్నట్లు గుర్తించండి", hi: "खरीदा हुआ चिह्नित करें" },
  youPurchased: { en: "You purchased this", te: "మీరు దీన్ని కొన్నారు", hi: "आपने इसे खरीदा है" },
  fullyPurchased: { en: "Already purchased", te: "ఇప్పటికే కొనుగోలు చేశారు", hi: "पहले ही खरीदा जा चुका है" },
  stillNeeded: { en: "Still needed", te: "ఇంకా కావాల్సినవి", hi: "अभी ज़रूरत है" },
  quantity: { en: "Quantity", te: "పరిమాణం", hi: "मात्रा" },
  undo: { en: "Undo", te: "రద్దు చేయండి", hi: "पूर्ववत करें" },
  viewItem: { en: "View item", te: "వస్తువును చూడండి", hi: "वस्तु देखें" },
  cashGifts: { en: "Cash gifts", te: "నగదు బహుమతులు", hi: "नकद उपहार" },
  copy: { en: "Copy", te: "కాపీ చేయండి", hi: "कॉपी करें" },
  copied: { en: "Copied", te: "కాపీ అయింది", hi: "कॉपी हो गया" },
  contribute: { en: "Contribute", te: "సహకరించండి", hi: "योगदान दें" },
  comingSoon: { en: "Coming soon", te: "త్వరలో వస్తుంది", hi: "जल्द आ रहा है" },
  registryEmpty: { en: "No registry items yet", te: "ఇంకా రిజిస్ట్రీ అంశాలు లేవు", hi: "अभी कोई रजिस्ट्री आइटम नहीं है" },
  nothingYet: { en: "Nothing here yet", te: "ఇంకా ఏమీ లేదు", hi: "अभी यहाँ कुछ नहीं है" },
  checkBackSoon: { en: "Please check back soon.", te: "దయచేసి త్వరలో మళ్లీ చూడండి.", hi: "कृपया जल्द ही दोबारा देखें।" },
  claimSoldOut: { en: "Someone just marked the last one as purchased.", te: "ఎవరో చివరిదాన్ని ఇప్పుడే కొన్నట్లు గుర్తించారు.", hi: "किसी ने अभी-अभी आखिरी वाला खरीदा हुआ चिह्नित किया है।" },
  claimTooMany: { en: "Not that many are left.", te: "అన్ని మిగిలి లేవు.", hi: "इतने नहीं बचे हैं।" },
  claimFailed: { en: "We couldn't save that. Please try again.", te: "దాన్ని సేవ్ చేయలేకపోయాము. దయచేసి మళ్లీ ప్రయత్నించండి.", hi: "हम इसे सहेज नहीं सके। कृपया पुनः प्रयास करें।" },
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
