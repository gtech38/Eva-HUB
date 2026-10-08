/**
 * Invitation-link lifetime (docs/02-users-and-roles.md §2 rule 3): a link stays valid until the
 * event ends plus 90 days. Pure date rules only, shared by admin (issues tokens) and web
 * (opens INVITE_LINK sessions); no Prisma here so client and test code can import it.
 */

const DAY_MS = 864e5;

/** Days an invitation link stays valid after the event ends. */
export const INVITE_GRACE_DAYS = 90;
/** Lifetime of a link for an event with no dates yet, counted from issue time. */
export const INVITE_FALLBACK_DAYS = 180;

export type EventDates = {
  startsOn: Date | null;
  subEvents: ReadonlyArray<{ startsAt: Date; endsAt: Date | null }>;
};

/**
 * When the event is over: the latest sub-event end (`endsAt`, else `startsAt`) or
 * `Event.startsOn`, whichever is later. `null` when the event has no dates at all.
 */
export function eventEnd(event: EventDates): Date | null {
  let end = event.startsOn?.getTime() ?? null;
  for (const s of event.subEvents) {
    const t = (s.endsAt ?? s.startsAt).getTime();
    if (end === null || t > end) end = t;
  }
  return end === null ? null : new Date(end);
}

/** Expiry for an invitation token issued at `now`: event end + 90 days, or now + 180 days without dates. */
export function inviteExpiry(event: EventDates, now: Date = new Date()): Date {
  const end = eventEnd(event);
  return end ? new Date(end.getTime() + INVITE_GRACE_DAYS * DAY_MS) : new Date(now.getTime() + INVITE_FALLBACK_DAYS * DAY_MS);
}
