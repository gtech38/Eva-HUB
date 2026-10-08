import { prisma } from "@hub/db";

/** The viewer's household with every member's invites, meal options and current responses. */
export async function loadHousehold(householdId: string) {
  const hh = await prisma.household.findUnique({
    where: { id: householdId },
    include: {
      guests: {
        where: { deletedAt: null },
        orderBy: [{ isPrimaryContact: "desc" }, { isPlusOne: "asc" }, { createdAt: "asc" }],
        include: {
          invites: { include: { subEvent: { include: { mealOptions: { orderBy: { sortOrder: "asc" } } } } } },
          rsvps: true,
        },
      },
    },
  });
  if (!hh) return null;
  const subEvents = new Map<string, (typeof hh.guests)[number]["invites"][number]["subEvent"]>();
  for (const g of hh.guests) for (const i of g.invites) subEvents.set(i.subEventId, i.subEvent);
  const sorted = [...subEvents.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.sortOrder - b.sortOrder);
  return { household: hh, subEvents: sorted };
}

export type HouseholdData = NonNullable<Awaited<ReturnType<typeof loadHousehold>>>;
