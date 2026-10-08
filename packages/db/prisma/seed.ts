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

  // ── Event 2 & 3: exercise the other two themes (DRAFT) ──
  for (const e of [
    { slug: "sofia-james", title: { en: "Sofia & James" }, theme: "LUXURY" as const, monogram: "S&J" },
    { slug: "emma-liam", title: { en: "Emma & Liam" }, theme: "ROMANTIC" as const, monogram: "E&L" },
  ]) {
    const ev = await prisma.event.upsert({
      where: { studioId_slug: { studioId: studio.id, slug: e.slug } },
      create: { studioId: studio.id, slug: e.slug, title: e.title, theme: e.theme, themeOverrides: { monogram: e.monogram }, status: "LIVE", startsOn: new Date("2027-05-01T00:00:00-05:00") },
      update: {},
    });
    await prisma.domain.upsert({ where: { hostname: `${e.slug}.${ROOT}` }, create: { hostname: `${e.slug}.${ROOT}`, studioId: studio.id, eventId: ev.id, verifiedAt: new Date() }, update: {} });
    await prisma.eventPage.upsert({ where: { eventId_type: { eventId: ev.id, type: "HOME" } }, create: { eventId: ev.id, type: "HOME", content: { headline: { en: "We're getting married" }, dateLine: { en: "May 1, 2027" } } }, update: {} });
    if ((await prisma.subEvent.count({ where: { eventId: ev.id } })) === 0) {
      await prisma.subEvent.create({ data: { eventId: ev.id, name: { en: "Ceremony" }, startsAt: new Date("2027-05-01T16:00:00-05:00"), sortOrder: 0 } });
      await prisma.subEvent.create({ data: { eventId: ev.id, name: { en: "Reception" }, startsAt: new Date("2027-05-01T18:00:00-05:00"), servesMeal: true, sortOrder: 1, mealOptions: { create: [{ label: { en: "Beef" } }, { label: { en: "Salmon" } }, { label: { en: "Vegetarian" } }] } } });
    }
    // The admin is also a guest here so the same account spans events.
    if ((await prisma.guest.count({ where: { eventId: ev.id } })) === 0) {
      const hh = await prisma.household.create({ data: { studioId: studio.id, eventId: ev.id, name: "Gokul" } });
      const g = await prisma.guest.create({ data: { studioId: studio.id, eventId: ev.id, householdId: hh.id, firstName: "Gokul", lastName: "", email: "admin@localhost", isPrimaryContact: true, userId: admin.id } });
      for (const s of await prisma.subEvent.findMany({ where: { eventId: ev.id } })) {
        await prisma.subEventInvite.create({ data: { guestId: g.id, subEventId: s.id } });
        await prisma.rsvp.create({ data: { guestId: g.id, subEventId: s.id } });
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
  console.log(`Event site: http://priya-arjun.${ROOT}:${process.env.WEB_PORT ?? 3000}  (guests: lakshmi@localhost, maya@localhost, nikhil@localhost)`);
}

main().finally(() => prisma.$disconnect());
