import { describe, expect, it } from "vitest";
import * as invites from "./invites";

const event = { id: "e1", studioId: "s1", slug: "priya-arjun", title: { en: "Priya & Arjun" }, startsOn: null, defaultLocale: "en" };
const guest = { id: "g1", householdId: "h1", firstName: "Lakshmi", lastName: "Rao", email: "l@localhost", phone: null, isPlusOne: false };
const link = "http://priya-arjun.localhost:3000/i/tok";

describe("admin invites (presentation only)", () => {
  it("buildMessages puts the personal link in every channel", () => {
    const m = invites.buildMessages(event, guest, link, "");
    expect(m.subject).toBe("You're invited: Priya & Arjun");
    expect(m.text).toContain(link);
    expect(m.html).toContain(link);
    expect(m.smsBody).toContain(link);
  });

  it("buildMessages escapes host-typed intro text in HTML", () => {
    const m = invites.buildMessages(event, guest, link, "<b>Join us</b>");
    expect(m.html).toContain("&lt;b&gt;Join us&lt;/b&gt;");
    expect(m.html).not.toContain("<b>Join us</b>");
  });
});
