/**
 * Local seed: one studio, one platform admin (you), one event with 3 sub-events,
 * a few households, and the three themes exercised across two events.
 *
 * Idempotent: re-running updates in place.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ROOT = process.env.ROOT_DOMAIN ?? "localhost";

async function upsertUserWithEmail(email: string, displayName: string, extra: Partial<{ isPlatformAdmin: boolean }> = {}) {
  const existing = await prisma.contactPoint.findUnique({ where: { kind_value: { kind: "EMAIL", value: email } }, include: { user: true } });
  if (existing) {
    await prisma.user.update({ where: { id: existing.userId }, data: { displayName, status: "CLAIMED", ...extra } });
    return existing.user;
  }
  return prisma.user.create({
    data: {
      displayName,
      status: "CLAIMED",
      ...extra,
      contactPoints: { create: { kind: "EMAIL", value: email, verifiedAt: new Date(), isPrimary: true } },
    },
  });
}

async function main() {
  // ── You: platform admin + studio owner ──
  const admin = await upsertUserWithEmail("admin@localhost", "Gokul (Admin)", { isPlatformAdmin: true });

  const studio = await prisma.studio.upsert({
    where: { slug: "studio" },
    create: {
      slug: "studio",
      name: "Your Studio",
      brandJson: { credit: "Photography by Your Studio", url: "https://yourstudio.com", logoText: "YS" },
      faceIndexRetentionDays: 365,
    },
    update: {},
  });

  await prisma.studioMember.upsert({
    where: { studioId_userId: { studioId: studio.id, userId: admin.id } },
    create: { studioId: studio.id, userId: admin.id, role: "OWNER" },
    update: { role: "OWNER" },
  });

  await prisma.domain.upsert({
    where: { hostname: `app.${ROOT}` },
    create: { hostname: `app.${ROOT}`, studioId: studio.id, isPrimary: true, verifiedAt: new Date() },
    update: {},
  });

  // ── Event 1: Priya & Arjun (Hindu traditional) ──
  const host = await upsertUserWithEmail("priya@localhost", "Priya");
  const event = await prisma.event.upsert({
    where: { studioId_slug: { studioId: studio.id, slug: "priya-arjun" } },
    create: {
      studioId: studio.id,
      slug: "priya-arjun",
      title: { en: "Priya & Arjun", te: "ప్రియ & అర్జున్", hi: "प्रिया और अर्जुन" },
      startsOn: new Date("2026-12-12T00:00:00-06:00"),
      status: "LIVE",
      theme: "HINDU_TRADITIONAL",
      themeOverrides: { monogram: "P&A" },
      defaultLocale: "en",
      enabledLocales: ["en", "te", "hi"],
      galleryPublishedAt: new Date(),
    },
    update: {},
  });

  await prisma.domain.upsert({
    where: { hostname: `priya-arjun.${ROOT}` },
    create: { hostname: `priya-arjun.${ROOT}`, studioId: studio.id, eventId: event.id, verifiedAt: new Date() },
    update: {},
  });

  await prisma.eventMember.upsert({
    where: { eventId_userId_role: { eventId: event.id, userId: host.id, role: "HOST" } },
    create: { eventId: event.id, userId: host.id, role: "HOST" },
    update: {},
  });

  // Pages
  const pages: Array<{ type: "HOME" | "ABOUT" | "SCHEDULE" | "TRAVEL" | "FAQ" | "GALLERY" | "RSVP"; content: object; sortOrder: number }> = [
    { type: "HOME", sortOrder: 0, content: { headline: { en: "We're getting married", te: "మేము పెళ్లి చేసుకుంటున్నాము", hi: "हम शादी कर रहे हैं" }, dateLine: { en: "December 12, 2026 · Dallas, Texas" }, heroKey: null } },
    { type: "ABOUT", sortOrder: 1, content: { story: { en: "We met in Austin in 2019 over a very bad cup of chai and have been arguing about the right amount of ginger ever since." } } },
    { type: "SCHEDULE", sortOrder: 2, content: { intro: { en: "Three days of celebration. Dress codes are listed under each event." } } },
    { type: "TRAVEL", sortOrder: 3, content: { hotels: [{ name: "Hotel Placeholder Dallas", url: "https://example.com", note: { en: "Room block under 'Priya & Arjun' until Nov 1." } }], airport: { en: "DFW is 25 minutes from the venue." } } },
    { type: "FAQ", sortOrder: 4, content: { items: [{ q: { en: "Can I bring my kids?" }, a: { en: "Yes — all events are family-friendly." } }, { q: { en: "Is there parking?" }, a: { en: "Complimentary valet at every venue." } }] } },
    { type: "GALLERY", sortOrder: 5, content: { intro: { en: "Find yourself in the photos with a selfie, or browse by event." } } },
    { type: "RSVP", sortOrder: 6, content: { intro: { en: "Please respond by November 15." } } },
  ];
  for (const p of pages) {
    await prisma.eventPage.upsert({
      where: { eventId_type: { eventId: event.id, type: p.type } },
      create: { eventId: event.id, type: p.type, sortOrder: p.sortOrder, content: p.content },
      update: { content: p.content, sortOrder: p.sortOrder },
    });
  }

  // Sub-events
  const existingSubs = await prisma.subEvent.findMany({ where: { eventId: event.id } });
  let subs = existingSubs;
  if (existingSubs.length === 0) {
    const haldi = await prisma.subEvent.create({ data: { eventId: event.id, name: { en: "Haldi", te: "హల్దీ", hi: "हल्दी" }, startsAt: new Date("2026-12-10T10:00:00-06:00"), venueName: "Family Home", dressCode: { en: "Yellow, something you don't mind staining" }, sortOrder: 0 } });
    const sangeet = await prisma.subEvent.create({ data: { eventId: event.id, name: { en: "Sangeet", te: "సంగీత్", hi: "संगीत" }, startsAt: new Date("2026-12-11T18:00:00-06:00"), venueName: "The Grand Ballroom", dressCode: { en: "Festive Indian" }, servesMeal: true, sortOrder: 1, mealOptions: { create: [{ label: { en: "Vegetarian" }, sortOrder: 0 }, { label: { en: "Non-vegetarian" }, sortOrder: 1 }, { label: { en: "Kids meal" }, isKidsMeal: true, sortOrder: 2 }] } } });
    const ceremony = await prisma.subEvent.create({ data: { eventId: event.id, name: { en: "Wedding Ceremony", te: "పెళ్లి", hi: "विवाह" }, startsAt: new Date("2026-12-12T09:00:00-06:00"), venueName: "Sri Temple Hall", dressCode: { en: "Traditional" }, sortOrder: 2 } });
    const reception = await prisma.subEvent.create({ data: { eventId: event.id, name: { en: "Reception", te: "రిసెప్షన్", hi: "रिसेप्शन" }, startsAt: new Date("2026-12-12T18:30:00-06:00"), venueName: "The Grand Ballroom", dressCode: { en: "Black tie optional" }, servesMeal: true, sortOrder: 3, mealOptions: { create: [{ label: { en: "Vegetarian" }, sortOrder: 0 }, { label: { en: "Fish" }, sortOrder: 1 }, { label: { en: "Chicken" }, sortOrder: 2 }, { label: { en: "Kids meal" }, isKidsMeal: true, sortOrder: 3 }] } } });
    subs = [haldi, sangeet, ceremony, reception];
  }

  // Households & guests
  const guestCount = await prisma.guest.count({ where: { eventId: event.id } });
  if (guestCount === 0) {
    const allSubs = subs.map((s) => s.id);
    const noHaldi = subs.filter((s) => (s.name as { en: string }).en !== "Haldi").map((s) => s.id);

    const mk = async (hh: { name: string; plusOnes?: number; side?: string }, members: Array<{ first: string; last: string; email?: string; phone?: string; child?: boolean; plusOne?: boolean; primary?: boolean; userId?: string }>, subIds: string[]) => {
      const household = await prisma.household.create({ data: { studioId: studio.id, eventId: event.id, name: hh.name, plusOnesAllowed: hh.plusOnes ?? 0, side: hh.side } });
      for (const m of members) {
        const g = await prisma.guest.create({ data: { studioId: studio.id, eventId: event.id, householdId: household.id, firstName: m.first, lastName: m.last, email: m.email, phone: m.phone, isChild: !!m.child, isPlusOne: !!m.plusOne, isPrimaryContact: !!m.primary, userId: m.userId } });
        for (const subId of subIds) {
          await prisma.subEventInvite.create({ data: { guestId: g.id, subEventId: subId } });
          await prisma.rsvp.create({ data: { guestId: g.id, subEventId: subId } });
        }
      }
    };

    await mk({ name: "Priya & Arjun", side: "couple" }, [{ first: "Priya", last: "Sharma", email: "priya@localhost", primary: true, userId: host.id }, { first: "Arjun", last: "Rao", email: "arjun@localhost" }], allSubs);
    await mk({ name: "The Rao Family", side: "groom", plusOnes: 0 }, [{ first: "Lakshmi", last: "Rao", email: "lakshmi@localhost", phone: "+15125550101", primary: true }, { first: "Venkat", last: "Rao", phone: "+15125550102" }, { first: "Ananya", last: "Rao", child: true }], allSubs);
    await mk({ name: "Maya Chen", side: "bride", plusOnes: 1 }, [{ first: "Maya", last: "Chen", email: "maya@localhost", primary: true }, { first: "", last: "", plusOne: true }], noHaldi);
    await mk({ name: "The Patels", side: "bride" }, [{ first: "Nikhil", last: "Patel", email: "nikhil@localhost", primary: true }, { first: "Riya", last: "Patel", email: "riya@localhost" }], noHaldi);
  }

  // Albums
  if ((await prisma.album.count({ where: { eventId: event.id } })) === 0) {
    for (const [i, s] of subs.entries()) {
      await prisma.album.create({ data: { studioId: studio.id, eventId: event.id, subEventId: s.id, title: s.name as object, sortOrder: i } });
    }
    await prisma.album.create({ data: { studioId: studio.id, eventId: event.id, title: { en: "Getting Ready" }, visibility: "HOSTS_ONLY", sortOrder: 99 } });
  }

  // ── Every other theme gets a fully populated event so themes can be compared page for page ──
  type SubSpec = { name: object; startsAt: string; venue?: string; dress?: string; meal?: string[]; order: number };
  type EventSpec = {
    slug: string; title: object; kind: "WEDDING" | "BABY_SHOWER" | "CEREMONY" | "PARTY";
    theme: "LUXURY" | "ROMANTIC" | "NURSERY_SAGE" | "TELUGU_TRADITIONAL" | "MIDNIGHT_GALA";
    monogram: string; startsOn: string; tz: string; locales: string[];
    home: object; about: object; travel: object; faq: object; subs: SubSpec[];
    households: Array<{ name: string; side?: string; plusOnes?: number; members: Array<{ first: string; last: string; email?: string; phone?: string; child?: boolean; plusOne?: boolean; primary?: boolean; userId?: string }>; skip?: string[] }>;
    albums: string[];
  };

  const specs: EventSpec[] = [
    {
      slug: "sofia-james", title: { en: "Sofia & James" }, kind: "WEDDING", theme: "LUXURY", monogram: "S&J",
      startsOn: "2027-05-01T00:00:00-05:00", tz: "America/Chicago", locales: ["en"],
      home: { headline: { en: "We're getting married" }, dateLine: { en: "May 1, 2027 · The Adolphus, Dallas" } },
      about: { story: { en: "Sofia and James met at a supper club in Deep Ellum in 2021, discovered a shared weakness for old-fashioneds and older films, and have been planning this evening ever since." } },
      travel: { hotels: [{ name: "The Adolphus", url: "https://example.com", note: { en: "Room block under 'Sofia & James' until April 1." } }], airport: { en: "DFW and Love Field are both 20 minutes away." } },
      faq: { items: [{ q: { en: "What is the dress code?" }, a: { en: "Black tie. Floor-length gowns and tuxedos." } }, { q: { en: "Is there parking?" }, a: { en: "Valet at the hotel entrance." } }] },
      subs: [
        { name: { en: "Welcome Cocktails" }, startsAt: "2027-04-30T19:00:00-05:00", venue: "The French Room Bar", dress: "Cocktail", order: 0 },
        { name: { en: "Ceremony" }, startsAt: "2027-05-01T16:30:00-05:00", venue: "The Adolphus Grand Ballroom", dress: "Black tie", order: 1 },
        { name: { en: "Dinner & Dancing" }, startsAt: "2027-05-01T18:30:00-05:00", venue: "The Adolphus Grand Ballroom", dress: "Black tie", meal: ["Filet", "Sea bass", "Wild mushroom risotto", "Kids meal"], order: 2 },
        { name: { en: "Farewell Brunch" }, startsAt: "2027-05-02T10:30:00-05:00", venue: "City Hall Bistro", dress: "Smart casual", order: 3 },
      ],
      households: [
        { name: "Sofia & James", side: "couple", members: [{ first: "Sofia", last: "Alvarez", email: "sofia@localhost", primary: true }, { first: "James", last: "Whitfield", email: "james@localhost" }] },
        { name: "The Whitfields", side: "groom", members: [{ first: "Margaret", last: "Whitfield", email: "margaret@localhost", primary: true }, { first: "Robert", last: "Whitfield", phone: "+12145550111" }] },
        { name: "Gokul", members: [{ first: "Gokul", last: "", email: "admin@localhost", primary: true, userId: admin.id }] },
        { name: "Elena Park", side: "bride", plusOnes: 1, members: [{ first: "Elena", last: "Park", email: "elena@localhost", primary: true }, { first: "", last: "", plusOne: true }], skip: ["Farewell Brunch"] },
      ],
      albums: ["Welcome Cocktails", "Ceremony", "Dinner & Dancing", "Portraits"],
    },
    {
      slug: "emma-liam", title: { en: "Emma & Liam" }, kind: "WEDDING", theme: "ROMANTIC", monogram: "E&L",
      startsOn: "2027-06-12T00:00:00-05:00", tz: "America/Chicago", locales: ["en"],
      home: { headline: { en: "We're getting married" }, dateLine: { en: "June 12, 2027 · Hill Country, Texas" } },
      about: { story: { en: "A camping trip, a flat tyre and a very long walk to the nearest town: that was the first date. Everything since has been easier, and better." } },
      travel: { hotels: [{ name: "Camp Lucy", url: "https://example.com", note: { en: "Cabins on site; book early." } }], airport: { en: "Austin-Bergstrom is 45 minutes away." } },
      faq: { items: [{ q: { en: "Can I bring my kids?" }, a: { en: "We love your kids, but this one is adults only." } }, { q: { en: "Will the ceremony be outdoors?" }, a: { en: "Yes, under the oaks. Bring a wrap for the evening." } }] },
      subs: [
        { name: { en: "Rehearsal Dinner" }, startsAt: "2027-06-11T18:30:00-05:00", venue: "Tillie's", dress: "Garden party", order: 0 },
        { name: { en: "Ceremony" }, startsAt: "2027-06-12T17:00:00-05:00", venue: "The Oak Grove", dress: "Cocktail", order: 1 },
        { name: { en: "Reception" }, startsAt: "2027-06-12T18:30:00-05:00", venue: "The Barn", dress: "Cocktail", meal: ["Chicken", "Salmon", "Vegetarian"], order: 2 },
      ],
      households: [
        { name: "Emma & Liam", side: "couple", members: [{ first: "Emma", last: "Brooks", email: "emma@localhost", primary: true }, { first: "Liam", last: "O'Connor", email: "liam@localhost" }] },
        { name: "The O'Connors", side: "groom", members: [{ first: "Siobhan", last: "O'Connor", email: "siobhan@localhost", primary: true }, { first: "Declan", last: "O'Connor", phone: "+15125550177" }] },
        { name: "Gokul", members: [{ first: "Gokul", last: "", email: "admin@localhost", primary: true, userId: admin.id }] },
        { name: "Noah Kim", side: "bride", plusOnes: 1, members: [{ first: "Noah", last: "Kim", email: "noah@localhost", primary: true }, { first: "", last: "", plusOne: true }], skip: ["Rehearsal Dinner"] },
      ],
      albums: ["Rehearsal Dinner", "Ceremony", "Reception", "Golden Hour"],
    },
    {
      slug: "baby-reddy", title: { en: "Baby Reddy", te: "బేబీ రెడ్డి" }, kind: "BABY_SHOWER", theme: "NURSERY_SAGE", monogram: "M&K",
      startsOn: "2027-03-14T00:00:00-05:00", tz: "America/Chicago", locales: ["en", "te"],
      home: { headline: { en: "Meera & Karthik are expecting", te: "మీరా & కార్తీక్ బిడ్డను ఎదురుచూస్తున్నారు" }, dateLine: { en: "Sunday, March 14, 2027 · Plano" } },
      about: { story: { en: "Before the sleepless nights begin, we want one unhurried afternoon with the people we love most. Come for the food, stay for the terrible baby-name suggestions." } },
      travel: { hotels: [], airport: { en: "Plenty of street parking; the house is the one with the sage balloons." } },
      faq: { items: [{ q: { en: "Is there a registry?" }, a: { en: "Yes, under Registry. Your presence is the real gift." } }, { q: { en: "Can we bring the kids?" }, a: { en: "Please do. There will be a craft table." } }] },
      subs: [
        { name: { en: "Seemantham", te: "సీమంతం" }, startsAt: "2027-03-14T10:00:00-05:00", venue: "Reddy Residence", dress: "Traditional", order: 0 },
        { name: { en: "Brunch & Games", te: "బ్రంచ్" }, startsAt: "2027-03-14T12:30:00-05:00", venue: "Reddy Residence", dress: "Pastels welcome", meal: ["Vegetarian", "Vegan", "Kids meal"], order: 1 },
      ],
      households: [
        { name: "Meera & Karthik", side: "hosts", members: [{ first: "Meera", last: "Reddy", email: "meera@localhost", primary: true }, { first: "Karthik", last: "Reddy", email: "karthik@localhost" }] },
        { name: "The Rao Family", members: [{ first: "Lakshmi", last: "Rao", email: "lakshmi@localhost", phone: "+15125550101", primary: true }, { first: "Venkat", last: "Rao", phone: "+15125550102" }, { first: "Ananya", last: "Rao", child: true }] },
        { name: "Gokul", members: [{ first: "Gokul", last: "", email: "admin@localhost", primary: true, userId: admin.id }] },
      ],
      albums: ["Seemantham", "Brunch & Games", "Family Portraits"],
    },
    {
      slug: "reddy-gruhapravesam", title: { en: "Gruhapravesam · The Reddy Home", te: "గృహప్రవేశం · రెడ్డి గృహం" }, kind: "CEREMONY", theme: "TELUGU_TRADITIONAL", monogram: "శ్రీ",
      startsOn: "2027-02-20T00:00:00-06:00", tz: "America/Chicago", locales: ["en", "te", "hi"],
      home: { headline: { en: "Srinivas & Padma invite you to bless their new home", te: "శ్రీనివాస్ & పద్మ తమ నూతన గృహాన్ని ఆశీర్వదించమని మిమ్మల్ని ఆహ్వానిస్తున్నారు" }, dateLine: { en: "Saturday, February 20, 2027 · Frisco", te: "శనివారం, ఫిబ్రవరి 20, 2027 · ఫ్రిస్కో" } },
      about: { story: { en: "After eleven years in apartments, the Reddys have a front door of their own. Join the Ganapathi homam at dawn, the kalasa pravesam, and lunch on banana leaves.", te: "పదకొండు సంవత్సరాల తరువాత రెడ్డి కుటుంబానికి సొంత ఇల్లు. ఉదయం గణపతి హోమం, కలశ ప్రవేశం, అరటి ఆకులో భోజనానికి రండి." } },
      travel: { hotels: [{ name: "Hyatt Place Frisco", url: "https://example.com", note: { en: "Ten minutes from the house." } }], airport: { en: "DFW is 35 minutes away." } },
      faq: { items: [{ q: { en: "What should I wear?" }, a: { en: "Traditional. Pattu sarees and dhotis or kurtas are perfect; avoid black." } }, { q: { en: "What time does the homam start?" }, a: { en: "7:30 AM sharp. The muhurtham is at 9:12 AM." } }, { q: { en: "Gifts?" }, a: { en: "Your blessings are enough. No boxed gifts, please." } }] },
      subs: [
        { name: { en: "Ganapathi Homam", te: "గణపతి హోమం", hi: "गणपति होम" }, startsAt: "2027-02-20T07:30:00-06:00", venue: "The Reddy Home", dress: "Traditional", order: 0 },
        { name: { en: "Gruhapravesam · Muhurtham", te: "గృహప్రవేశం · ముహూర్తం", hi: "गृहप्रवेश · मुहूर्त" }, startsAt: "2027-02-20T09:12:00-06:00", venue: "The Reddy Home", dress: "Traditional", order: 1 },
        { name: { en: "Satyanarayana Vratam", te: "సత్యనారాయణ వ్రతం", hi: "सत्यनारायण व्रत" }, startsAt: "2027-02-20T11:00:00-06:00", venue: "The Reddy Home", order: 2 },
        { name: { en: "Lunch", te: "భోజనం", hi: "भोजन" }, startsAt: "2027-02-20T13:00:00-06:00", venue: "The Reddy Home · Backyard", meal: ["Vegetarian (banana leaf)", "Jain"], order: 3 },
      ],
      households: [
        { name: "Srinivas & Padma", side: "hosts", members: [{ first: "Srinivas", last: "Reddy", email: "srinivas@localhost", primary: true }, { first: "Padma", last: "Reddy", email: "padma@localhost" }] },
        { name: "The Rao Family", members: [{ first: "Lakshmi", last: "Rao", email: "lakshmi@localhost", phone: "+15125550101", primary: true }, { first: "Venkat", last: "Rao", phone: "+15125550102" }, { first: "Ananya", last: "Rao", child: true }] },
        { name: "Gokul", members: [{ first: "Gokul", last: "", email: "admin@localhost", primary: true, userId: admin.id }] },
        { name: "The Patels", members: [{ first: "Nikhil", last: "Patel", email: "nikhil@localhost", primary: true }, { first: "Riya", last: "Patel", email: "riya@localhost" }], skip: ["Ganapathi Homam"] },
      ],
      albums: ["Homam", "Gruhapravesam", "Vratam", "Lunch"],
    },
    {
      slug: "ravi-50", title: { en: "Ravi at Fifty" }, kind: "PARTY", theme: "MIDNIGHT_GALA", monogram: "50",
      startsOn: "2027-01-23T00:00:00-06:00", tz: "America/Chicago", locales: ["en"],
      home: { headline: { en: "Half a century. One night. No speeches longer than three minutes." }, dateLine: { en: "Saturday, January 23, 2027 · The Joule, Dallas" } },
      about: { story: { en: "Ravi has spent fifty years refusing to make a fuss. This is the fuss. Dinner, a very good band, and a bar that knows what it's doing." } },
      travel: { hotels: [{ name: "The Joule", url: "https://example.com", note: { en: "Rooms held under 'Ravi 50' until January 5." } }], airport: { en: "Downtown Dallas; valet at the door." } },
      faq: { items: [{ q: { en: "Dress code?" }, a: { en: "Black tie optional. Dark and sharp." } }, { q: { en: "Gifts?" }, a: { en: "None. If you must, the registry page has a charity Ravi cares about." } }, { q: { en: "When does it end?" }, a: { en: "Officially midnight. Unofficially, ask the band." } }] },
      subs: [
        { name: { en: "Cocktails" }, startsAt: "2027-01-23T19:00:00-06:00", venue: "The Joule · Rooftop", dress: "Black tie optional", order: 0 },
        { name: { en: "Dinner" }, startsAt: "2027-01-23T20:00:00-06:00", venue: "The Joule · Ballroom", meal: ["Short rib", "Halibut", "Vegetarian"], order: 1 },
        { name: { en: "The Band" }, startsAt: "2027-01-23T21:30:00-06:00", venue: "The Joule · Ballroom", order: 2 },
      ],
      households: [
        { name: "Ravi & Anjali", side: "hosts", members: [{ first: "Ravi", last: "Menon", email: "ravi@localhost", primary: true }, { first: "Anjali", last: "Menon", email: "anjali@localhost" }] },
        { name: "Gokul", members: [{ first: "Gokul", last: "", email: "admin@localhost", primary: true, userId: admin.id }] },
        { name: "Maya Chen", plusOnes: 1, members: [{ first: "Maya", last: "Chen", email: "maya@localhost", primary: true }, { first: "", last: "", plusOne: true }] },
        { name: "The Whitfields", members: [{ first: "Margaret", last: "Whitfield", email: "margaret@localhost", primary: true }, { first: "Robert", last: "Whitfield", phone: "+12145550111" }] },
      ],
      albums: ["Cocktails", "Dinner", "The Band", "Portraits"],
    },
  ];

  for (const e of specs) {
    const ev = await prisma.event.upsert({
      where: { studioId_slug: { studioId: studio.id, slug: e.slug } },
      create: { studioId: studio.id, slug: e.slug, title: e.title, kind: e.kind, theme: e.theme, themeOverrides: { monogram: e.monogram }, status: "LIVE", startsOn: new Date(e.startsOn), timezone: e.tz, defaultLocale: "en", enabledLocales: e.locales, galleryPublishedAt: new Date() },
      update: { kind: e.kind, theme: e.theme, title: e.title, enabledLocales: e.locales, startsOn: new Date(e.startsOn) },
    });
    await prisma.domain.upsert({ where: { hostname: `${e.slug}.${ROOT}` }, create: { hostname: `${e.slug}.${ROOT}`, studioId: studio.id, eventId: ev.id, verifiedAt: new Date() }, update: {} });

    const pageSet: Array<[string, object]> = [["HOME", e.home], ["ABOUT", e.about], ["SCHEDULE", { intro: {} }], ["TRAVEL", e.travel], ["FAQ", e.faq], ["GALLERY", { intro: {} }], ["RSVP", { intro: {} }]];
    for (const [i, [type, content]] of pageSet.entries()) {
      await prisma.eventPage.upsert({ where: { eventId_type: { eventId: ev.id, type: type as never } }, create: { eventId: ev.id, type: type as never, sortOrder: i, content }, update: { content, sortOrder: i } });
    }

    let subs = await prisma.subEvent.findMany({ where: { eventId: ev.id } });
    if (subs.length === 0) {
      subs = [];
      for (const s of e.subs) {
        subs.push(await prisma.subEvent.create({ data: { eventId: ev.id, name: s.name, startsAt: new Date(s.startsAt), venueName: s.venue, dressCode: s.dress ? { en: s.dress } : undefined, servesMeal: !!s.meal, sortOrder: s.order, mealOptions: s.meal ? { create: s.meal.map((label, i) => ({ label: { en: label }, isKidsMeal: /kids/i.test(label), sortOrder: i })) } : undefined } }));
      }
    }
    const subIdByName = new Map(subs.map((s) => [(s.name as { en: string }).en, s.id]));

    if ((await prisma.guest.count({ where: { eventId: ev.id } })) === 0) {
      for (const hh of e.households) {
        const household = await prisma.household.create({ data: { studioId: studio.id, eventId: ev.id, name: hh.name, side: hh.side, plusOnesAllowed: hh.plusOnes ?? 0 } });
        const invited = [...subIdByName.entries()].filter(([n]) => !(hh.skip ?? []).includes(n)).map(([, id]) => id);
        for (const m of hh.members) {
          const g = await prisma.guest.create({ data: { studioId: studio.id, eventId: ev.id, householdId: household.id, firstName: m.first, lastName: m.last, email: m.email, phone: m.phone, isChild: !!m.child, isPlusOne: !!m.plusOne, isPrimaryContact: !!m.primary, userId: m.userId } });
          for (const subId of invited) {
            await prisma.subEventInvite.create({ data: { guestId: g.id, subEventId: subId } });
            await prisma.rsvp.create({ data: { guestId: g.id, subEventId: subId } });
          }
        }
      }
    }

    if ((await prisma.album.count({ where: { eventId: ev.id } })) === 0) {
      for (const [i, name] of e.albums.entries()) {
        await prisma.album.create({ data: { studioId: studio.id, eventId: ev.id, subEventId: subIdByName.get(name) ?? null, title: { en: name }, sortOrder: i } });
      }
    }
  }

  // Price sheet placeholder
  const ps = await prisma.priceSheet.findFirst({ where: { studioId: studio.id } }) ?? await prisma.priceSheet.create({ data: { studioId: studio.id, name: "Default" } });
  if ((await prisma.product.count({ where: { priceSheetId: ps.id } })) === 0) {
    await prisma.product.createMany({ data: [
      { priceSheetId: ps.id, kind: "GALLERY_UNLOCK", name: "Full gallery download", priceCents: 150000 },
      { priceSheetId: ps.id, kind: "PRINT", name: "8×10 Lustre", priceCents: 2500, labSku: "PLACEHOLDER-8x10" },
      { priceSheetId: ps.id, kind: "PRINT", name: "16×20 Canvas", priceCents: 14900, labSku: "PLACEHOLDER-16x20C" },
    ] });
  }

  console.log(`Seeded. Sign in as admin@localhost at http://app.${ROOT}:${process.env.ADMIN_PORT ?? 3001}`);
  console.log(`Event sites (port ${process.env.WEB_PORT ?? 3000}): priya-arjun (Hindu wedding) · sofia-james (Luxury wedding) · emma-liam (Romantic wedding) · baby-reddy (Nursery Sage baby shower) · reddy-gruhapravesam (Telugu Traditional ceremony) · ravi-50 (Midnight Gala party)`);
  console.log(`Guests: lakshmi@localhost (priya-arjun, baby-reddy, reddy-gruhapravesam) · maya@localhost (priya-arjun, ravi-50) · margaret@localhost (sofia-james, ravi-50) · admin@localhost (all)`);
}

main().finally(() => prisma.$disconnect());
