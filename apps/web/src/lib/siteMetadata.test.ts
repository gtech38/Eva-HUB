import { describe, expect, it } from "vitest";
import { OG_IMAGE_PATH, SIGN_IN_DESCRIPTION, eventPreviewTitle, originForHost, siteMetadata } from "./siteMetadata.ts";

const input = { title: "ప్రియ & అర్జున్", previewTitle: "Priya & Arjun", origin: "http://priya-arjun.localhost:3000" };

describe("siteMetadata (crawler/unfurl metadata = the sign-in screen only)", () => {
  it("is exactly this object: nothing else can reach a preview", () => {
    expect(siteMetadata(input)).toEqual({
      metadataBase: new URL("http://priya-arjun.localhost:3000"),
      title: "ప్రియ & అర్జున్",
      description: "You're invited — sign in to view",
      robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
      openGraph: {
        title: "Priya & Arjun",
        description: "You're invited — sign in to view",
        type: "website",
        images: [{ url: "/og.png", width: 1200, height: 630, alt: "Priya & Arjun" }],
      },
      twitter: { card: "summary" },
    });
    expect(OG_IMAGE_PATH).toBe("/og.png");
    expect(SIGN_IN_DESCRIPTION).toBe("You're invited — sign in to view");
  });

  it("is a function of title, preview title and origin only", () => {
    const leaky = { ...input, dates: "2026-12-12", photo: "s/1/e/2/d/x.webp", guest: "Ravi" } as typeof input;
    const json = JSON.stringify(siteMetadata(leaky));
    expect(json).toBe(JSON.stringify(siteMetadata(input)));
    expect(json).not.toMatch(/2026|webp|Ravi/);
  });
});

describe("eventPreviewTitle", () => {
  const title = { en: "Priya & Arjun", te: "ప్రియ & అర్జున్" };
  it("uses the event's default locale (what a crawler with no cookie sees), same as /og.png", () => {
    expect(eventPreviewTitle({ title, defaultLocale: "te" })).toBe("ప్రియ & అర్జున్");
    expect(eventPreviewTitle({ title, defaultLocale: "en" })).toBe("Priya & Arjun");
  });
  it("falls back to English for an unknown default locale", () => {
    expect(eventPreviewTitle({ title, defaultLocale: "xx" })).toBe("Priya & Arjun");
  });
});

describe("originForHost (metadataBase from the host that resolved this event)", () => {
  it("dev: http and the web port", () => {
    expect(originForHost("priya-arjun.localhost", { ROOT_DOMAIN: "localhost", WEB_PORT: 3000 })).toBe("http://priya-arjun.localhost:3000");
  });
  it("prod: https, no port, custom domains kept as-is", () => {
    const e = { ROOT_DOMAIN: "evahub.app", WEB_PORT: 3000 };
    expect(originForHost("priya-arjun.evahub.app", e)).toBe("https://priya-arjun.evahub.app");
    expect(originForHost("priyaandarjun.com", e)).toBe("https://priyaandarjun.com");
  });
});
