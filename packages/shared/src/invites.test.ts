import { describe, expect, it } from "vitest";
import { eventEnd, inviteExpiry, INVITE_GRACE_DAYS, INVITE_FALLBACK_DAYS } from "./invites.ts";

const DAY = 864e5;
const d = (iso: string) => new Date(iso);
const plusDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY);
const NOW = d("2026-10-08T12:00:00Z");

describe("eventEnd", () => {
  it("is null when the event has no dates at all", () => {
    expect(eventEnd({ startsOn: null, subEvents: [] })).toBeNull();
  });

  it("is startsOn when there are no sub-events", () => {
    expect(eventEnd({ startsOn: d("2027-02-14T00:00:00Z"), subEvents: [] })).toEqual(d("2027-02-14T00:00:00Z"));
  });

  it("is a single sub-event's endsAt", () => {
    const ev = { startsOn: d("2027-02-14T00:00:00Z"), subEvents: [{ startsAt: d("2027-02-14T17:00:00Z"), endsAt: d("2027-02-14T23:30:00Z") }] };
    expect(eventEnd(ev)).toEqual(d("2027-02-14T23:30:00Z"));
  });

  it("is the latest sub-event end across a multi-day event", () => {
    const ev = {
      startsOn: d("2027-02-12T00:00:00Z"),
      subEvents: [
        { startsAt: d("2027-02-12T10:00:00Z"), endsAt: d("2027-02-12T13:00:00Z") },
        { startsAt: d("2027-02-15T18:00:00Z"), endsAt: d("2027-02-16T01:00:00Z") },
        { startsAt: d("2027-02-13T09:00:00Z"), endsAt: d("2027-02-13T12:00:00Z") },
      ],
    };
    expect(eventEnd(ev)).toEqual(d("2027-02-16T01:00:00Z"));
  });

  it("uses startsAt for a sub-event whose endsAt is missing", () => {
    const ev = {
      startsOn: d("2027-02-12T00:00:00Z"),
      subEvents: [
        { startsAt: d("2027-02-12T10:00:00Z"), endsAt: d("2027-02-12T13:00:00Z") },
        { startsAt: d("2027-02-14T18:00:00Z"), endsAt: null },
      ],
    };
    expect(eventEnd(ev)).toEqual(d("2027-02-14T18:00:00Z"));
  });

  it("works from sub-events alone when startsOn is not set", () => {
    const ev = { startsOn: null, subEvents: [{ startsAt: d("2027-03-01T18:00:00Z"), endsAt: null }] };
    expect(eventEnd(ev)).toEqual(d("2027-03-01T18:00:00Z"));
  });

  it("keeps startsOn when every sub-event ends before it", () => {
    const ev = { startsOn: d("2027-02-14T00:00:00Z"), subEvents: [{ startsAt: d("2027-02-10T10:00:00Z"), endsAt: d("2027-02-10T12:00:00Z") }] };
    expect(eventEnd(ev)).toEqual(d("2027-02-14T00:00:00Z"));
  });
});

describe("inviteExpiry", () => {
  it("grace and fallback windows match docs/02 §2 rule 3", () => {
    expect(INVITE_GRACE_DAYS).toBe(90);
    expect(INVITE_FALLBACK_DAYS).toBe(180);
  });

  it("event with reception ending after startsOn -> reception end + 90 d", () => {
    const receptionEnd = d("2027-02-16T01:00:00Z");
    const ev = {
      startsOn: d("2027-02-14T00:00:00Z"),
      subEvents: [
        { startsAt: d("2027-02-14T10:00:00Z"), endsAt: d("2027-02-14T13:00:00Z") },
        { startsAt: d("2027-02-15T18:00:00Z"), endsAt: receptionEnd },
      ],
    };
    expect(inviteExpiry(ev, NOW)).toEqual(plusDays(receptionEnd, 90));
  });

  it("no dates -> now + 180 d", () => {
    expect(inviteExpiry({ startsOn: null, subEvents: [] }, NOW)).toEqual(plusDays(NOW, 180));
  });

  it("startsOn only -> startsOn + 90 d", () => {
    const startsOn = d("2027-02-14T00:00:00Z");
    expect(inviteExpiry({ startsOn, subEvents: [] }, NOW)).toEqual(plusDays(startsOn, 90));
  });

  it("defaults `now` to the current time for the no-date fallback", () => {
    const before = Date.now();
    const exp = inviteExpiry({ startsOn: null, subEvents: [] }).getTime();
    expect(exp).toBeGreaterThanOrEqual(before + 180 * DAY);
    expect(exp).toBeLessThanOrEqual(Date.now() + 180 * DAY);
  });
});
