import Link from "next/link";
import { prisma } from "@hub/db";
import { t, type Locale, type LocalizedText } from "@hub/shared/i18n";
import { requireViewer } from "@/lib/site";
import { PageHeader, EmptyState } from "@/components/PageHeader";
import { FaceSearch, type FaceStrings } from "@/components/gallery/FaceSearch";
import { galleryStrings } from "@/lib/gallery-strings";
import { visiblePhotoWhere, isEntitledFullRes, toPhotoDTOs, type PhotoDTO } from "@/lib/gallery";
import { fullName } from "@/lib/format";

export const dynamic = "force-dynamic";

const S = {
  intro: {
    en: "Take a selfie and we'll find the photos you appear in. Your selfie is used once to compute a face signature and is never stored.",
    te: "ఒక సెల్ఫీ తీయండి, మీరు ఉన్న ఫోటోలను మేము కనుగొంటాము. మీ సెల్ఫీ ఒకసారి మాత్రమే ఉపయోగించబడుతుంది మరియు ఎప్పుడూ నిల్వ చేయబడదు.",
    hi: "एक सेल्फ़ी लें और हम वे तस्वीरें ढूँढेंगे जिनमें आप हैं। आपकी सेल्फ़ी केवल एक बार उपयोग होती है और कभी संग्रहीत नहीं की जाती।",
  },
  consentLabel: { en: "I agree to a one-time face search", te: "ఒకసారి ముఖ శోధనకు నేను అంగీకరిస్తున్నాను", hi: "मैं एक बार की चेहरा खोज के लिए सहमत हूँ" },
  consentDetail: {
    en: "A face signature is computed from your selfie and compared with faces in this event's gallery. The selfie is discarded immediately. The gallery's face index is deleted after the studio's retention period.",
    te: "మీ సెల్ఫీ నుండి ముఖ సంతకం లెక్కించబడి ఈ ఈవెంట్ గ్యాలరీలోని ముఖాలతో పోల్చబడుతుంది. సెల్ఫీ వెంటనే తొలగించబడుతుంది.",
    hi: "आपकी सेल्फ़ी से एक चेहरा-हस्ताक्षर बनाकर इस आयोजन की गैलरी के चेहरों से मिलाया जाता है। सेल्फ़ी तुरंत हटा दी जाती है।",
  },
  rememberLabel: { en: "Remember my face (optional)", te: "నా ముఖాన్ని గుర్తుంచుకో (ఐచ్ఛికం)", hi: "मेरा चेहरा याद रखें (वैकल्पिक)" },
  rememberDetail: {
    en: "Keep only the face signature on your account so new galleries you're invited to are matched automatically. Adults only. You can revoke this at any time.",
    te: "కొత్త గ్యాలరీలు స్వయంచాలకంగా సరిపోల్చడానికి ముఖ సంతకాన్ని మాత్రమే మీ ఖాతాలో ఉంచండి. పెద్దలకు మాత్రమే.",
    hi: "केवल चेहरा-हस्ताक्षर आपके खाते में रखा जाता है ताकि नई गैलरी अपने आप मिलाई जा सकें। केवल वयस्कों के लिए।",
  },
  searchFor: { en: "Search for", te: "ఎవరి కోసం వెతకాలి", hi: "किसके लिए खोजें" },
  me: { en: "Me", te: "నేను", hi: "मैं" },
  takeSelfie: { en: "Take a selfie", te: "సెల్ఫీ తీయండి", hi: "सेल्फ़ी लें" },
  searching: { en: "Searching…", te: "వెతుకుతోంది…", hi: "खोज रहे हैं…" },
  again: { en: "Search again", te: "మళ్ళీ వెతకండి", hi: "फिर से खोजें" },
  noMatches: { en: "No matching photos yet. Try again once more photos are published.", te: "ఇంకా సరిపోలే ఫోటోలు లేవు.", hi: "अभी तक कोई मेल खाती तस्वीर नहीं।" },
  resultsTitle: { en: "Matches", te: "సరిపోలికలు", hi: "मेल" },
  familyTitle: { en: "Family photos", te: "కుటుంబ ఫోటోలు", hi: "परिवार की तस्वीरें" },
  previous: { en: "Photos of you", te: "మీ ఫోటోలు", hi: "आपकी तस्वीरें" },
  disabled: { en: "Face search is not enabled for this event.", te: "ఈ ఈవెంట్‌కు ముఖ శోధన ప్రారంభించబడలేదు.", hi: "इस आयोजन के लिए चेहरा खोज सक्षम नहीं है।" },
  errUnavailable: { en: "Face search is temporarily unavailable. Please try again in a little while.", te: "ముఖ శోధన తాత్కాలికంగా అందుబాటులో లేదు. కాసేపటి తర్వాత మళ్ళీ ప్రయత్నించండి.", hi: "चेहरा खोज अस्थायी रूप से उपलब्ध नहीं है। कृपया थोड़ी देर बाद पुनः प्रयास करें।" },
  errNoFace: { en: "We couldn't find a face in that photo. Try again with your face centered and well lit.", te: "ఆ ఫోటోలో ముఖం కనిపించలేదు. మళ్ళీ ప్రయత్నించండి.", hi: "उस तस्वीर में चेहरा नहीं मिला। कृपया पुनः प्रयास करें।" },
  errMultiple: { en: "Please use a selfie with just one face.", te: "ఒకే ముఖం ఉన్న సెల్ఫీ ఉపయోగించండి.", hi: "कृपया केवल एक चेहरे वाली सेल्फ़ी का उपयोग करें।" },
  errConsent: { en: "Please tick the consent box first.", te: "దయచేసి ముందుగా అంగీకార పెట్టెను టిక్ చేయండి.", hi: "कृपया पहले सहमति बॉक्स पर टिक करें।" },
  errOptOut: { en: "Face search has been turned off for this guest.", te: "ఈ అతిథికి ముఖ శోధన ఆపివేయబడింది.", hi: "इस अतिथि के लिए चेहरा खोज बंद कर दी गई है।" },
  errTooLarge: { en: "That image is too large. Please use a photo under 12 MB.", te: "ఆ చిత్రం చాలా పెద్దది. 12 MB లోపు ఫోటో ఉపయోగించండి.", hi: "वह छवि बहुत बड़ी है। कृपया 12 MB से छोटी तस्वीर का उपयोग करें।" },
} satisfies Record<string, LocalizedText>;

function faceStrings(locale: Locale): FaceStrings {
  const g = (k: keyof typeof S) => t(S[k], locale);
  return {
    title: "",
    intro: g("intro"),
    consentLabel: g("consentLabel"),
    consentDetail: g("consentDetail"),
    rememberLabel: g("rememberLabel"),
    rememberDetail: g("rememberDetail"),
    searchFor: g("searchFor"),
    me: g("me"),
    takeSelfie: g("takeSelfie"),
    searching: g("searching"),
    again: g("again"),
    noMatches: g("noMatches"),
    resultsTitle: g("resultsTitle"),
    familyTitle: g("familyTitle"),
    previous: g("previous"),
    errors: {
      unavailable: g("errUnavailable"),
      no_face: g("errNoFace"),
      multiple_faces: g("errMultiple"),
      consent_required: g("errConsent"),
      opted_out: g("errOptOut"),
      too_large: g("errTooLarge"),
      disabled: g("disabled"),
      forbidden: g("errUnavailable"),
      unauthorized: g("errUnavailable"),
    },
  };
}

export default async function MyPhotosPage() {
  const site = await requireViewer();
  if (!site) return null;
  const { event, locale, viewer } = site;
  const G = galleryStrings(locale);
  const F = faceStrings(locale);

  const back = (
    <p className="mb-4 text-sm">
      <Link href="/gallery" className="underline underline-offset-4 hover:opacity-70">
        ← {G.backToGallery}
      </Link>
    </p>
  );

  if (!event.faceSearchEnabled || !viewer.can("face.search")) {
    return (
      <div>
        {back}
        <PageHeader title={G.myPhotos} />
        <EmptyState title={G.myPhotos} body={t(S.disabled, locale)} />
      </div>
    );
  }

  // Children in the viewer's household → guardian search subjects.
  const children = viewer.guest
    ? await prisma.guest.findMany({ where: { eventId: event.id, householdId: viewer.guest.householdId, isChild: true, deletedAt: null, faceSearchOptOut: false }, orderBy: { createdAt: "asc" } })
    : [];
  const subjects = [{ id: "me", label: F.me }, ...children.map((c) => ({ id: c.id, label: fullName(c) }))];

  // Previously matched photos (PhotoMatch survives the face-index purge).
  const entitled = await isEntitledFullRes(event.id, viewer.principal.userId);
  const withScores = async (matches: Array<{ photoId: string; score: number }>): Promise<PhotoDTO[]> => {
    if (matches.length === 0) return [];
    const scores = new Map(matches.map((m) => [m.photoId, m.score]));
    const photos = await prisma.photo.findMany({ where: visiblePhotoWhere(event.id, viewer, { id: { in: [...scores.keys()] } }) });
    photos.sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
    return toPhotoDTOs(photos, viewer, { entitled, scores });
  };
  const me = await withScores(await prisma.photoMatch.findMany({ where: { userId: viewer.principal.userId, photo: { eventId: event.id } }, select: { photoId: true, score: true } }));
  const family = await Promise.all(
    children.map(async (c) => ({
      guestId: c.id,
      name: fullName(c),
      photos: await withScores(await prisma.photoMatch.findMany({ where: { subjectGuestId: c.id }, select: { photoId: true, score: true } })),
    })),
  );

  const canRemember = !!viewer.guest && !viewer.guest.isChild;

  return (
    <div>
      {back}
      <PageHeader title={G.myPhotos} />
      <FaceSearch strings={F} gallery={G} subjects={subjects} canRemember={canRemember} canFavorite={viewer.can("favorites")} previous={{ me, family }} />
    </div>
  );
}
