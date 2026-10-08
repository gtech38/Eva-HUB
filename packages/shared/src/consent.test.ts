import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ConsentKind as PrismaConsentKind } from "@hub/db";
import { LOCALES } from "./i18n.ts";
import {
  CONSENT_FILE_STEMS,
  CONSENT_KINDS,
  CONSENT_TEXT_VERSION,
  consentBlocks,
  consentRecordVersion,
  consentText,
  parseConsentFile,
  singleVersion,
} from "./consent.ts";

const V1 = fileURLToPath(new URL("../../../legal/consent/v1/", import.meta.url));

// Compile-time: the loader's kinds are exactly the Prisma enum.
const kindsAreThePrismaEnum: PrismaConsentKind[] = [...CONSENT_KINDS];
const prismaEnumIsCovered: (typeof CONSENT_KINDS)[number] = "SEARCH_SELF" as PrismaConsentKind;

describe("consent text files (legal/consent/v1)", () => {
  it("covers every ConsentKind", () => {
    expect([...kindsAreThePrismaEnum].sort()).toStrictEqual(["FACE_PROFILE", "SEARCH_GUARDIAN", "SEARCH_SELF"]);
    expect(prismaEnumIsCovered).toBe("SEARCH_SELF");
  });

  it("has exactly one file per kind x locale and nothing else", () => {
    const expected = CONSENT_KINDS.flatMap((k) => LOCALES.map((l) => `${CONSENT_FILE_STEMS[k]}.${l}.md`)).sort();
    expect(expected).toHaveLength(9);
    const onDisk = readdirSync(V1).filter((f) => !f.startsWith("._")).sort();
    expect(onDisk).toStrictEqual(expected);
  });

  for (const kind of CONSENT_KINDS) {
    for (const locale of LOCALES) {
      const file = `${CONSENT_FILE_STEMS[kind]}.${locale}.md`;
      it(`${file} exists with complete front matter and a non-empty body`, () => {
        const path = V1 + file;
        expect(existsSync(path), `${file} is missing`).toBe(true);
        const doc = parseConsentFile(readFileSync(path, "utf8"));
        expect(doc.meta.kind).toBe(kind);
        expect(doc.meta.locale).toBe(locale);
        expect(doc.meta.version).toBe(CONSENT_TEXT_VERSION);
        expect(doc.meta.effective).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(doc.meta).toHaveProperty("reviewed_by");
        expect(doc.meta.status).toBe("DRAFT — pending attorney review (LEG-006)");
        expect(doc.body.trim().length).toBeGreaterThan(200);
      });
    }
  }

  it("every file carries the same version", () => {
    const versions = readdirSync(V1)
      .filter((f) => f.endsWith(".md") && !f.startsWith("._"))
      .map((f) => parseConsentFile(readFileSync(V1 + f, "utf8")).meta.version);
    expect(new Set(versions)).toStrictEqual(new Set(["v1-2026-10"]));
    expect(CONSENT_TEXT_VERSION).toBe("v1-2026-10");
  });
});

describe("parseConsentFile", () => {
  it("splits front matter from the body; empty values are empty strings", () => {
    const doc = parseConsentFile("---\nversion: v9\nreviewed_by:\nstatus: DRAFT — x: y\n---\n\nHello\n");
    expect(doc.meta).toStrictEqual({ version: "v9", reviewed_by: "", status: "DRAFT — x: y" });
    expect(doc.body).toBe("Hello");
  });

  it("rejects a file without front matter", () => {
    expect(() => parseConsentFile("Hello")).toThrow(/front matter/);
  });
});

describe("singleVersion", () => {
  it("returns the shared version", () => {
    expect(singleVersion(["v1-2026-10", "v1-2026-10"])).toBe("v1-2026-10");
  });

  it("throws when versions diverge or one is missing", () => {
    expect(() => singleVersion(["v1-2026-10", "v1-2026-11"])).toThrow(/diverge/);
    expect(() => singleVersion(["v1-2026-10", undefined])).toThrow(/missing/);
    expect(() => singleVersion([])).toThrow(/missing/);
  });
});

describe("consentText", () => {
  it("returns the bundled text for every kind x locale", () => {
    for (const kind of CONSENT_KINDS) {
      for (const locale of LOCALES) {
        const doc = consentText(kind, locale);
        expect(doc.kind).toBe(kind);
        expect(doc.locale).toBe(locale);
        expect(doc.version).toBe(CONSENT_TEXT_VERSION);
        expect(doc.body.length).toBeGreaterThan(200);
      }
    }
  });

  it("says the selfie is never stored, in English, for every kind", () => {
    for (const kind of CONSENT_KINDS) expect(consentText(kind, "en").body).toMatch(/never stored/i);
  });

  it("the guardian text contains the parent/guardian attestation", () => {
    expect(consentText("SEARCH_GUARDIAN", "en").body).toMatch(/parent or legal guardian/i);
  });

  it("names the withdrawal routes and the 3-year profile purge", () => {
    expect(consentText("SEARCH_SELF", "en").body).toMatch(/remove me from face search/i);
    expect(consentText("FACE_PROFILE", "en").body).toMatch(/account settings/i);
    expect(consentText("FACE_PROFILE", "en").body).toMatch(/3 years/);
  });
});

describe("consentRecordVersion", () => {
  it("is kind:version so the three texts are distinguishable", () => {
    expect(consentRecordVersion("SEARCH_SELF")).toBe("SEARCH_SELF:v1-2026-10");
    expect(consentRecordVersion("SEARCH_GUARDIAN")).toBe("SEARCH_GUARDIAN:v1-2026-10");
    expect(consentRecordVersion("FACE_PROFILE")).toBe("FACE_PROFILE:v1-2026-10");
  });
});

describe("consentBlocks", () => {
  it("turns the markdown subset into headings, paragraphs and lists", () => {
    const md = "## What we collect\n\nA face signature\nfrom your selfie.\n\n- one\n- two that\n  wraps\n\nLast.";
    expect(consentBlocks(md)).toStrictEqual([
      { type: "heading", text: "What we collect" },
      { type: "paragraph", text: "A face signature from your selfie." },
      { type: "list", items: ["one", "two that wraps"] },
      { type: "paragraph", text: "Last." },
    ]);
  });
});
