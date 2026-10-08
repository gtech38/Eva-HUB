import { describe, expect, it } from "vitest";
import { OG_IMAGE_PATH, SIGN_IN_DESCRIPTION, siteMetadata } from "./siteMetadata.ts";

const input = { title: "Priya & Arjun", origin: "http://priya-arjun.localhost:3000" };

describe("siteMetadata (crawler/unfurl metadata = the sign-in screen only)", () => {
  it("titles the page, og and twitter with the sign-in screen's title", () => {
    const m = siteMetadata(input);
    expect(m.title).toBe("Priya & Arjun");
    expect(m.openGraph).toMatchObject({ title: "Priya & Arjun", type: "website" });
    expect(m.twitter).toMatchObject({ card: "summary" });
  });

  it("uses the fixed invitation description, never event content", () => {
    const m = siteMetadata(input);
    expect(SIGN_IN_DESCRIPTION).toBe("You're invited — sign in to view");
    expect(m.description).toBe(SIGN_IN_DESCRIPTION);
    expect(m.openGraph?.description).toBe(SIGN_IN_DESCRIPTION);
  });

  it("og:image is the per-site /og.png, resolved against the site origin", () => {
    const m = siteMetadata(input);
    expect(OG_IMAGE_PATH).toBe("/og.png");
    expect(m.metadataBase?.toString()).toBe("http://priya-arjun.localhost:3000/");
    const images = m.openGraph?.images;
    expect(Array.isArray(images) ? images : [images]).toEqual([
      { url: "/og.png", width: 1200, height: 630, alt: "Priya & Arjun" },
    ]);
  });

  it("keeps the site out of every index (same robots as the root layout)", () => {
    expect(siteMetadata(input).robots).toEqual({
      index: false,
      follow: false,
      nocache: true,
      googleBot: { index: false, follow: false },
    });
  });

  it("is a function of title and origin only: no other field can leak into a preview", () => {
    // Extra properties (as if someone passed the whole event) must not change the output.
    const leaky = { ...input, dates: "2026-12-12", photo: "s/1/e/2/d/x.webp", guest: "Ravi" } as typeof input;
    const json = JSON.stringify(siteMetadata(leaky));
    expect(json).toBe(JSON.stringify(siteMetadata(input)));
    expect(json).not.toMatch(/2026|webp|Ravi/);
  });
});
