import { describe, expect, it } from "vitest";
import { ui } from "@hub/shared/i18n";
import { buildNavItems } from "./nav.ts";
import { hostsPageLabel } from "./eventCopy.ts";

const nav = (over: Partial<Parameters<typeof buildNavItems>[0]> = {}) =>
  buildNavItems({ enabledPages: [], kind: "WEDDING", locale: "en", path: "/", ...over });

describe("buildNavItems", () => {
  it("always lists Home, Schedule, RSVP and Gallery", () => {
    expect(nav().map((i) => i.href)).toEqual(["/", "/schedule", "/rsvp", "/gallery"]);
  });

  it("lists the Wedding Party and Registry pages when enabled, in site order", () => {
    const hrefs = nav({ enabledPages: ["REGISTRY", "WEDDING_PARTY", "FAQ", "ABOUT", "TRAVEL"] }).map((i) => i.href);
    expect(hrefs).toEqual(["/", "/about", "/schedule", "/travel", "/party", "/faq", "/registry", "/rsvp", "/gallery"]);
  });

  it("does not list Wedding Party or Registry when the pages are not enabled", () => {
    const hrefs = nav({ enabledPages: ["FAQ"] }).map((i) => i.href);
    expect(hrefs).not.toContain("/party");
    expect(hrefs).not.toContain("/registry");
  });

  it("labels the Wedding Party page with ui('party') for weddings, in each locale", () => {
    for (const locale of ["en", "te", "hi"] as const) {
      const item = nav({ enabledPages: ["WEDDING_PARTY"], locale }).find((i) => i.href === "/party");
      expect(item?.label).toBe(ui("party", locale));
    }
  });

  it("keeps the kind-aware label for non-wedding events", () => {
    const item = nav({ enabledPages: ["WEDDING_PARTY"], kind: "BABY_SHOWER" }).find((i) => i.href === "/party");
    expect(item?.label).toBe(hostsPageLabel("BABY_SHOWER", "en"));
    expect(item?.label).toBe("Hosts");
  });

  it("marks the current page, and only Home on the exact root path", () => {
    const items = nav({ enabledPages: ["WEDDING_PARTY"], path: "/party" });
    expect(items.filter((i) => i.current).map((i) => i.href)).toEqual(["/party"]);
    expect(nav({ path: "/" }).filter((i) => i.current).map((i) => i.href)).toEqual(["/"]);
  });
});
