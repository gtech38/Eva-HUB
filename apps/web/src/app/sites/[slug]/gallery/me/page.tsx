import Link from "next/link";
import { prisma } from "@hub/db";
import { t, type Locale, type LocalizedText } from "@hub/shared/i18n";
import { requireViewer } from "@/lib/site";
import { PageHeader, EmptyState } from "@/components/PageHeader";
import { FaceSearch, type FaceStrings } from "@/components/gallery/FaceSearch";
import { galleryStrings } from "@/lib/gallery-strings";
import { visiblePhotoWhere, isEntitledFullRes, toPhotoDTOs, type PhotoDTO } from "@/lib/gallery";
import { fullName } from "@/lib/format";
import { consentTextsFor } from "@/lib/consentTexts";
import { FACE_PROFILE_ENROLMENT, faceSearchAllowed } from "@/lib/faceConsent";

export const dynamic = "force-dynamic";

// Consent checkbox labels, summaries and full texts come from legal/consent/* (versioned), not here.
const S = {
  intro: {
    en: "Take a selfie and we'll find the photos you appear in. Your selfie is processed temporarily to compute a face signature, then deleted. It is never saved.",
    te: "ఒక సెల్ఫీ తీయండి, మీరు ఉన్న ఫోటోలను మేము కనుగొంటాము. ముఖ సంతకాన్ని లెక్కించడానికి మీ సెల్ఫీ తాత్కాలికంగా ప్రాసెస్ చేయబడి, ఆ తర్వాత తొలగించబడుతుంది. అది ఎప్పుడూ సేవ్ చేయబడదు.",
    hi: "एक सेल्फ़ी लें और हम वे तस्वीरें ढूँढेंगे जिनमें आप हैं। चेहरा-हस्ताक्षर बनाने के लिए आपकी सेल्फ़ी को अस्थायी रूप से संसाधित करके हटा दिया जाता है। वह कभी सहेजी नहीं जाती।",
  },
  consentFull: { en: "What you're agreeing to", te: "మీరు దేనికి అంగీకరిస్తున్నారు", hi: "आप किस बात के लिए सहमति दे रहे हैं" },
  consentVersion: { en: "Consent text version", te: "అంగీకార పాఠం వెర్షన్", hi: "सहमति पाठ संस्करण" },
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
  errStale: {
    en: "The consent text has been updated since this page loaded. Please read it again and tick the box before searching.",
    te: "ఈ పేజీ తెరిచిన తర్వాత అంగీకార పాఠం మారింది. దయచేసి దాన్ని మళ్ళీ చదివి, శోధించే ముందు పెట్టెను టిక్ చేయండి.",
    hi: "यह पेज खुलने के बाद सहमति पाठ बदल गया है। कृपया इसे फिर से पढ़ें और खोजने से पहले बॉक्स पर टिक करें।",
  },
  errOptOut: { en: "Face search has been turned off for this guest.", te: "ఈ అతిథికి ముఖ శోధన ఆపివేయబడింది.", hi: "इस अतिथि के लिए चेहरा खोज बंद कर दी गई है।" },
  errTooLarge: { en: "That image is too large. Please use a photo under 12 MB.", te: "ఆ చిత్రం చాలా పెద్దది. 12 MB లోపు ఫోటో ఉపయోగించండి.", hi: "वह छवि बहुत बड़ी है। कृपया 12 MB से छोटी तस्वीर का उपयोग करें।" },
} satisfies Record<string, LocalizedText>;

function faceStrings(locale: Locale): FaceStrings {
  const g = (k: keyof typeof S) => t(S[k], locale);
  return {
    title: "",
    intro: g("intro"),
    consentFull: g("consentFull"),
    consentVersion: g("consentVersion"),
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
      consent_stale: g("errStale"),
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

  if (!event.faceSearchEnabled || !faceSearchAllowed(process.env.NODE_ENV) || !viewer.can("face.search")) {
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

  // Hidden until face profiles can be revoked by their owner (WEB-006); the route ignores `remember` too.
  const canRemember = FACE_PROFILE_ENROLMENT && !!viewer.guest && !viewer.guest.isChild;

  return (
    <div>
      {back}
      <PageHeader title={G.myPhotos} />
      <FaceSearch strings={F} consentTexts={consentTextsFor(locale)} gallery={G} subjects={subjects} canRemember={canRemember} canFavorite={viewer.can("favorites")} previous={{ me, family }} />
    </div>
  );
}
