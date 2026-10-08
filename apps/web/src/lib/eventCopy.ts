/**
 * Kind-aware copy for theme chrome. Themes render the same components for a wedding,
 * a baby shower or a gala; only these strings change. Host-authored content (headline,
 * dateLine, story) still comes from EventPage and is not affected.
 */
import type { EventKind } from "@hub/db";
import { t, type Locale, type LocalizedText } from "@hub/shared/i18n";

export type EventCopy = {
  /** small uppercase line under the names: "are getting married" */
  eyebrow: string;
  /** script/display accent word: "Married!" */
  accent: string;
  /** invitation lead-in on hero panels: "You're invited" */
  invite: string;
  /** closing line for sign-in screens and footers: "with love" */
  signoff: string;
};

type CopySet = Record<keyof EventCopy, LocalizedText>;

const COPY: Record<EventKind, CopySet> = {
  WEDDING: {
    eyebrow: { en: "are getting married", te: "పెళ్లి చేసుకుంటున్నారు", hi: "शादी कर रहे हैं" },
    accent: { en: "Married!", te: "శుభ వివాహం", hi: "शुभ विवाह" },
    invite: { en: "You're invited", te: "మీకు ఆహ్వానం", hi: "आप आमंत्रित हैं" },
    signoff: { en: "with love", te: "ప్రేమతో", hi: "प्यार के साथ" },
  },
  ENGAGEMENT: {
    eyebrow: { en: "are engaged", te: "నిశ్చితార్థం", hi: "सगाई" },
    accent: { en: "Engaged!", te: "శుభ నిశ్చితార్థం", hi: "शुभ सगाई" },
    invite: { en: "You're invited", te: "మీకు ఆహ్వానం", hi: "आप आमंत्रित हैं" },
    signoff: { en: "with love", te: "ప్రేమతో", hi: "प्यार के साथ" },
  },
  BABY_SHOWER: {
    eyebrow: { en: "a little one is on the way", te: "చిన్నారి రాబోతోంది", hi: "नन्हा मेहमान आ रहा है" },
    accent: { en: "Oh, baby", te: "శ్రీమంతం", hi: "गोद भराई" },
    invite: { en: "Please join us to celebrate", te: "మాతో కలిసి ఆనందించండి", hi: "कृपया हमारे साथ जश्न मनाएं" },
    signoff: { en: "with joy", te: "ఆనందంతో", hi: "खुशी के साथ" },
  },
  BIRTHDAY: {
    eyebrow: { en: "a birthday celebration", te: "పుట్టినరోజు వేడుక", hi: "जन्मदिन समारोह" },
    accent: { en: "Cheers!", te: "శుభాకాంక్షలు", hi: "शुभकामनाएं" },
    invite: { en: "You're invited", te: "మీకు ఆహ్వానం", hi: "आप आमंत्रित हैं" },
    signoff: { en: "see you there", te: "అక్కడ కలుద్దాం", hi: "वहाँ मिलते हैं" },
  },
  ANNIVERSARY: {
    eyebrow: { en: "celebrating their anniversary", te: "వివాహ వార్షికోత్సవం", hi: "सालगिरह" },
    accent: { en: "Still us", te: "శుభాకాంక్షలు", hi: "शुभकामनाएं" },
    invite: { en: "Please join us", te: "మాతో చేరండి", hi: "कृपया हमारे साथ शामिल हों" },
    signoff: { en: "with love", te: "ప్రేమతో", hi: "प्यार के साथ" },
  },
  CEREMONY: {
    eyebrow: { en: "a traditional celebration", te: "శుభ కార్యం", hi: "शुभ कार्य" },
    accent: { en: "Blessings", te: "శుభాశీస్సులు", hi: "शुभाशीष" },
    invite: { en: "With the blessings of our elders, you are invited", te: "పెద్దల ఆశీస్సులతో మీకు ఆహ్వానం", hi: "बड़ों के आशीर्वाद से आप आमंत्रित हैं" },
    signoff: { en: "with warm regards", te: "శుభాకాంక్షలతో", hi: "सादर" },
  },
  PARTY: {
    eyebrow: { en: "an evening to remember", te: "మరపురాని సాయంత్రం", hi: "एक यादगार शाम" },
    accent: { en: "Cheers", te: "చీర్స్", hi: "चीयर्स" },
    invite: { en: "You're on the list", te: "మీకు ఆహ్వానం", hi: "आप आमंत्रित हैं" },
    signoff: { en: "see you there", te: "అక్కడ కలుద్దాం", hi: "वहाँ मिलते हैं" },
  },
  CORPORATE: {
    eyebrow: { en: "you are cordially invited", te: "మీకు సాదర ఆహ్వానం", hi: "आपको सादर आमंत्रित किया जाता है" },
    accent: { en: "Welcome", te: "స్వాగతం", hi: "स्वागत" },
    invite: { en: "You're invited", te: "మీకు ఆహ్వానం", hi: "आप आमंत्रित हैं" },
    signoff: { en: "regards", te: "శుభాకాంక్షలతో", hi: "सादर" },
  },
  OTHER: {
    eyebrow: { en: "a celebration", te: "వేడుక", hi: "उत्सव" },
    accent: { en: "Welcome", te: "స్వాగతం", hi: "स्वागत" },
    invite: { en: "You're invited", te: "మీకు ఆహ్వానం", hi: "आप आमंत्रित हैं" },
    signoff: { en: "with warm regards", te: "శుభాకాంక్షలతో", hi: "सादर" },
  },
};

export function eventCopy(kind: EventKind, locale: Locale): EventCopy {
  const set = COPY[kind] ?? COPY.OTHER;
  return {
    eyebrow: t(set.eyebrow, locale),
    accent: t(set.accent, locale),
    invite: t(set.invite, locale),
    signoff: t(set.signoff, locale),
  };
}

const HOSTS_LABEL: Partial<Record<EventKind, LocalizedText>> = {
  WEDDING: { en: "Wedding Party", te: "పెళ్లి బృందం", hi: "शादी की टोली" },
  ENGAGEMENT: { en: "Wedding Party", te: "బృందం", hi: "टोली" },
  CEREMONY: { en: "Family", te: "కుటుంబం", hi: "परिवार" },
  ANNIVERSARY: { en: "Family", te: "కుటుంబం", hi: "परिवार" },
};
const HOSTS_DEFAULT: LocalizedText = { en: "Hosts", te: "ఆతిథ్యం", hi: "मेज़बान" };

/** Nav label for the WEDDING_PARTY page type, which doubles as "Hosts" for non-weddings. */
export function hostsPageLabel(kind: EventKind, locale: Locale): string {
  return t(HOSTS_LABEL[kind] ?? HOSTS_DEFAULT, locale);
}
