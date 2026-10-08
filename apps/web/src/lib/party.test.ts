import { describe, expect, it } from "vitest";
import { groupByRole, isEventSiteKey } from "./party.ts";

const m = (name: string, role: Record<string, string> = {}) => ({ name, role, photoKey: null, blurb: {} });

describe("groupByRole", () => {
  it("groups members under their localized role, keeping first-seen order", () => {
    const groups = groupByRole(
      [m("Ana", { en: "Bridesmaid" }), m("Raj", { en: "Groomsman" }), m("Bea", { en: "Bridesmaid" }), m("Kit", { en: "Best man" })],
      "en",
    );
    expect(groups.map((g) => g.role)).toEqual(["Bridesmaid", "Groomsman", "Best man"]);
    expect(groups[0]!.members.map((x) => x.name)).toEqual(["Ana", "Bea"]);
  });

  it("uses the viewer's locale and falls back to English when the role is untranslated", () => {
    const groups = groupByRole([m("Ana", { en: "Bridesmaid", te: "పెళ్లికూతురి స్నేహితురాలు" }), m("Raj", { en: "Groomsman" })], "te");
    expect(groups.map((g) => g.role)).toEqual(["పెళ్లికూతురి స్నేహితురాలు", "Groomsman"]);
  });

  it("merges roles that differ only by case or surrounding whitespace", () => {
    const groups = groupByRole([m("Ana", { en: "Bridesmaid" }), m("Bea", { en: " bridesmaid " })], "en");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members).toHaveLength(2);
  });

  it("puts members with no role into one group with an empty heading, after the named roles", () => {
    const groups = groupByRole([m("Ana"), m("Raj", { en: "Groomsman" }), m("Bea", {})], "en");
    expect(groups.map((g) => g.role)).toEqual(["Groomsman", ""]);
    expect(groups[1]!.members.map((x) => x.name)).toEqual(["Ana", "Bea"]);
  });

  it("returns no groups for no members", () => {
    expect(groupByRole([], "en")).toEqual([]);
  });
});

describe("isEventSiteKey", () => {
  it("accepts keys under this studio and event's site/ prefix", () => {
    expect(isEventSiteKey("s/st1/e/ev1/site/party-a.jpg", "st1", "ev1")).toBe(true);
  });

  it("rejects originals, photo derivatives and zips of the same event: only site/ assets may be signed for every guest", () => {
    for (const key of [
      "s/st1/e/ev1/orig/photo1.jpg",
      "s/st1/e/ev1/d/photo1/web.jpg",
      "s/st1/e/ev1/d/hiddenPhoto/thumb.jpg",
      "s/st1/e/ev1/zip/z1-1.zip",
      "s/st1/e/ev1/sitemap/x.jpg",
      "s/st1/e/ev1/site",
      "s/st1/e/ev1/",
    ]) {
      expect(isEventSiteKey(key, "st1", "ev1"), key).toBe(false);
    }
  });

  it("rejects another event's or studio's key, traversal and non-strings", () => {
    expect(isEventSiteKey("s/st1/e/ev2/site/a.jpg", "st1", "ev1")).toBe(false);
    expect(isEventSiteKey("s/st2/e/ev1/site/a.jpg", "st1", "ev1")).toBe(false);
    expect(isEventSiteKey("s/st1/e/ev1/site/../orig/a.jpg", "st1", "ev1")).toBe(false);
    expect(isEventSiteKey("s/st1/e/ev1/../ev2/site/a.jpg", "st1", "ev1")).toBe(false);
    expect(isEventSiteKey("s/st1/e/ev1/site/a\\..\\b.jpg", "st1", "ev1")).toBe(false);
    expect(isEventSiteKey("s/st1/e/ev10/site/a.jpg", "st1", "ev1")).toBe(false);
    expect(isEventSiteKey(null, "st1", "ev1")).toBe(false);
    expect(isEventSiteKey(undefined, "st1", "ev1")).toBe(false);
  });
});
