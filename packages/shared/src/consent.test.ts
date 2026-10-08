import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ConsentKind as PrismaConsentKind } from "@hub/db";
import { LOCALES, type Locale } from "./i18n.ts";
import {
  CONSENT_FILE_STEMS,
  CONSENT_KINDS,
  CONSENT_VERSIONS,
  CURRENT_CONSENT_VERSION,
  buildConsentVersion,
  consentBlocks,
  consentRecordVersion,
  consentText,
  parseConsentFile,
  parseConsentRecordVersion,
  singleVersion,
  unreviewedConsentDocs,
  type ConsentKind,
} from "./consent.ts";

const ROOT = fileURLToPath(new URL("../../../legal/consent/", import.meta.url));
const versionDirs = () => readdirSync(ROOT).filter((d) => /^v\d+$/.test(d)).sort();
const fileName = (kind: ConsentKind, locale: Locale) => `${CONSENT_FILE_STEMS[kind]}.${locale}.md`;

// Compile-time check, enforced by `tsc` (pnpm typecheck), not by vitest: the loader's kinds and the
// Prisma `ConsentKind` enum are the same union. If either side gains a kind, this line stops compiling.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const kindsMatchPrisma: Same<ConsentKind, PrismaConsentKind> = true;
void kindsMatchPrisma;

describe("consent text files (legal/consent/v*)", () => {
  it("bundles exactly the version directories on disk, current one included", () => {
    expect(CONSENT_VERSIONS.map((v) => v.dir).sort()).toStrictEqual(versionDirs());
    expect(new Set(CONSENT_VERSIONS.map((v) => v.version)).size).toBe(CONSENT_VERSIONS.length);
    expect(CONSENT_VERSIONS.map((v) => v.version)).toContain(CURRENT_CONSENT_VERSION);
    expect(CURRENT_CONSENT_VERSION).toBe("v1-2026-10");
  });

  for (const dir of versionDirs()) {
    it(`${dir}: has exactly one file per kind x locale and nothing else`, () => {
      const expected = CONSENT_KINDS.flatMap((k) => LOCALES.map((l) => fileName(k, l))).sort();
      expect(expected).toHaveLength(9);
      expect(readdirSync(ROOT + dir).filter((f) => !f.startsWith("._")).sort()).toStrictEqual(expected);
    });

    it(`${dir}: every file has complete front matter, one shared version, and is bundled into its own slot`, () => {
      const bundled = CONSENT_VERSIONS.find((v) => v.dir === dir);
      expect(bundled, `${dir} is not bundled in consent.ts`).toBeDefined();
      const versions: string[] = [];
      for (const kind of CONSENT_KINDS) {
        for (const locale of LOCALES) {
          const path = `${ROOT}${dir}/${fileName(kind, locale)}`;
          expect(existsSync(path), `${path} is missing`).toBe(true);
          const onDisk = parseConsentFile(readFileSync(path, "utf8"));
          expect(onDisk.meta.kind).toBe(kind);
          expect(onDisk.meta.locale).toBe(locale);
          expect(onDisk.meta.effective).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(onDisk.meta).toHaveProperty("reviewed_by");
          expect(onDisk.meta.label?.length).toBeGreaterThan(10);
          expect(onDisk.meta.summary?.length).toBeGreaterThan(20);
          expect(onDisk.body.length).toBeGreaterThan(200);
          versions.push(onDisk.meta.version);
          // Slot wiring: what the loader returns for (kind, locale) is this file, not a neighbour.
          const doc = bundled!.docs[kind][locale];
          expect(doc.body).toBe(onDisk.body);
          expect(doc.label).toBe(onDisk.meta.label);
          expect(doc.summary).toBe(onDisk.meta.summary);
        }
      }
      expect(new Set(versions)).toStrictEqual(new Set([bundled!.version]));
    });
  }

  it("v1 is a draft pending attorney review; te/hi are flagged as machine-drafted", () => {
    for (const kind of CONSENT_KINDS) {
      for (const locale of LOCALES) {
        const d = consentText(kind, locale, "v1-2026-10");
        expect(d.status).toBe("DRAFT — pending attorney review (LEG-006)");
        expect(d.translation !== "").toBe(locale !== "en");
      }
    }
  });
});

describe("buildConsentVersion", () => {
  const file = (kind: string, locale: string, version = "v9-2030-01") =>
    `---\nversion: ${version}\neffective: 2030-01-01\nkind: ${kind}\nlocale: ${locale}\nstatus: DRAFT\nreviewed_by:\nlabel: I agree to a thing\nsummary: A short summary of the thing.\n---\n\nBody`;
  const raws = (override?: { kind: ConsentKind; locale: Locale; raw: string }) =>
    Object.fromEntries(
      CONSENT_KINDS.map((k) => [k, Object.fromEntries(LOCALES.map((l) => [l, override && override.kind === k && override.locale === l ? override.raw : file(k, l)]))]),
    ) as Record<ConsentKind, Record<Locale, string>>;

  it("builds a version from nine well-formed files", () => {
    const v = buildConsentVersion("v9", raws());
    expect(v.version).toBe("v9-2030-01");
    expect(v.docs.SEARCH_GUARDIAN.te.label).toBe("I agree to a thing");
  });

  it("throws when a file is wired into the wrong kind or locale slot", () => {
    expect(() => buildConsentVersion("v9", raws({ kind: "SEARCH_SELF", locale: "hi", raw: file("SEARCH_GUARDIAN", "hi") }))).toThrow(/SEARCH_SELF\.hi.*SEARCH_GUARDIAN\.hi/);
    expect(() => buildConsentVersion("v9", raws({ kind: "SEARCH_SELF", locale: "hi", raw: file("SEARCH_SELF", "te") }))).toThrow(/slot/);
  });

  it("throws when versions diverge or label/summary is missing", () => {
    expect(() => buildConsentVersion("v9", raws({ kind: "FACE_PROFILE", locale: "en", raw: file("FACE_PROFILE", "en", "v9-2030-02") }))).toThrow(/diverge/);
    const noLabel = file("FACE_PROFILE", "en").replace(/^label:.*\n/m, "");
    expect(() => buildConsentVersion("v9", raws({ kind: "FACE_PROFILE", locale: "en", raw: noLabel }))).toThrow(/label/);
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
  it("defaults to the current version and accepts an explicit one", () => {
    expect(consentText("SEARCH_SELF", "en").version).toBe(CURRENT_CONSENT_VERSION);
    expect(consentText("SEARCH_SELF", "te", "v1-2026-10").locale).toBe("te");
  });

  it("throws for an unknown version", () => {
    expect(() => consentText("SEARCH_SELF", "en", "v0-1999-01")).toThrow(/unknown consent version/);
  });

  it("says the selfie is never saved, in English, for every kind", () => {
    for (const kind of CONSENT_KINDS) expect(consentText(kind, "en").body).toMatch(/never saved/i);
  });

  it("the guardian label carries the parent/guardian attestation", () => {
    expect(consentText("SEARCH_GUARDIAN", "en").label).toMatch(/parent or legal guardian/i);
    expect(consentText("SEARCH_GUARDIAN", "en").summary).not.toMatch(/your selfie/i);
  });

  it("does not promise controls or automation that do not exist yet", () => {
    for (const kind of CONSENT_KINDS) {
      for (const locale of LOCALES) {
        const d = consentText(kind, locale);
        const text = `${d.label} ${d.summary} ${d.body}`;
        expect(text).not.toMatch(/in memory only|automatically|Remove me from face search|Account settings/i);
      }
    }
    expect(consentText("SEARCH_SELF", "en").body).toMatch(/contact the studio/i);
  });
});

describe("consent record versions", () => {
  it("consentRecordVersion is kind:version so the three texts are distinguishable", () => {
    expect(consentRecordVersion("SEARCH_SELF")).toBe("SEARCH_SELF:v1-2026-10");
    expect(consentRecordVersion("SEARCH_GUARDIAN")).toBe("SEARCH_GUARDIAN:v1-2026-10");
    expect(consentRecordVersion("FACE_PROFILE", "v1-2026-10")).toBe("FACE_PROFILE:v1-2026-10");
  });

  it("parseConsentRecordVersion reads a stored value back", () => {
    expect(parseConsentRecordVersion("SEARCH_GUARDIAN:v1-2026-10")).toStrictEqual({ kind: "SEARCH_GUARDIAN", version: "v1-2026-10" });
    expect(parseConsentRecordVersion("v1-2026-10")).toBe(null);
    expect(parseConsentRecordVersion("NOPE:v1-2026-10")).toBe(null);
    expect(parseConsentRecordVersion("SEARCH_SELF:")).toBe(null);
  });
});

describe("unreviewedConsentDocs", () => {
  it("lists every current doc while reviewed_by is empty (v1 is unreviewed)", () => {
    expect(unreviewedConsentDocs()).toHaveLength(9);
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

  it("splits a heading directly followed by a list or paragraph without a blank line", () => {
    expect(consentBlocks("## Heading\n- a\n- b\n## Next\nText")).toStrictEqual([
      { type: "heading", text: "Heading" },
      { type: "list", items: ["a", "b"] },
      { type: "heading", text: "Next" },
      { type: "paragraph", text: "Text" },
    ]);
  });

  it("no rendered block of any bundled text still starts with markdown syntax", () => {
    for (const v of CONSENT_VERSIONS) {
      for (const kind of CONSENT_KINDS) {
        for (const locale of LOCALES) {
          const texts = consentBlocks(v.docs[kind][locale].body).flatMap((b) => (b.type === "list" ? b.items : [b.text]));
          for (const t of texts) expect(t, `${v.dir} ${kind}.${locale}`).not.toMatch(/^(#|[-*] )/);
        }
      }
    }
  });
});
