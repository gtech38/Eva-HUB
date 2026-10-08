/// <reference path="./raw.d.ts" />
/**
 * Biometric consent texts. The words a person agrees to live in `legal/consent/<version>/` as
 * markdown with front matter and are bundled at build time (`?raw` imports), so the UI, the
 * BiometricConsent row and the admin legal page all read the same files. The version recorded on
 * a consent row is `<kind>:<version>` from those files' front matter -- never a hand-kept constant.
 *
 * Changing any wording means a new version directory (see legal/consent/README.md), then pointing
 * the imports below at it.
 */
import type { Locale } from "./i18n.ts";

import searchSelfEn from "../../../legal/consent/v1/search_self.en.md?raw";
import searchSelfTe from "../../../legal/consent/v1/search_self.te.md?raw";
import searchSelfHi from "../../../legal/consent/v1/search_self.hi.md?raw";
import searchGuardianEn from "../../../legal/consent/v1/search_guardian.en.md?raw";
import searchGuardianTe from "../../../legal/consent/v1/search_guardian.te.md?raw";
import searchGuardianHi from "../../../legal/consent/v1/search_guardian.hi.md?raw";
import faceProfileEn from "../../../legal/consent/v1/face_profile.en.md?raw";
import faceProfileTe from "../../../legal/consent/v1/face_profile.te.md?raw";
import faceProfileHi from "../../../legal/consent/v1/face_profile.hi.md?raw";

/** Mirrors the Prisma `ConsentKind` enum (checked in consent.test.ts). */
export const CONSENT_KINDS = ["SEARCH_SELF", "SEARCH_GUARDIAN", "FACE_PROFILE"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

/** File name stem per kind: `legal/consent/<version>/<stem>.<locale>.md`. */
export const CONSENT_FILE_STEMS: Record<ConsentKind, string> = {
  SEARCH_SELF: "search_self",
  SEARCH_GUARDIAN: "search_guardian",
  FACE_PROFILE: "face_profile",
};

const RAW: Record<ConsentKind, Record<Locale, string>> = {
  SEARCH_SELF: { en: searchSelfEn, te: searchSelfTe, hi: searchSelfHi },
  SEARCH_GUARDIAN: { en: searchGuardianEn, te: searchGuardianTe, hi: searchGuardianHi },
  FACE_PROFILE: { en: faceProfileEn, te: faceProfileTe, hi: faceProfileHi },
};

export type ConsentFile = { meta: Record<string, string>; body: string };

export type ConsentDoc = {
  kind: ConsentKind;
  locale: Locale;
  version: string;
  effective: string;
  /** Empty until counsel signs off (LEG-006). */
  reviewedBy: string;
  status: string;
  /** Set on machine-drafted translations pending native review. */
  translation: string;
  body: string;
};

/** Minimal front matter: `key: value` per line between `---` fences. Values may contain colons. */
export function parseConsentFile(raw: string): ConsentFile {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) throw new Error("consent file has no front matter");
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: m[2].trim() };
}

/** The one version shared by every file; throws if any file lacks one or they disagree. */
export function singleVersion(versions: Array<string | undefined>): string {
  if (versions.length === 0 || versions.some((v) => !v)) throw new Error("consent text version missing from front matter");
  const unique = new Set(versions);
  if (unique.size > 1) throw new Error(`consent text versions diverge: ${[...unique].join(", ")}`);
  return versions[0] as string;
}

const DOCS: Record<ConsentKind, Record<Locale, ConsentDoc>> = Object.fromEntries(
  CONSENT_KINDS.map((kind) => [
    kind,
    Object.fromEntries(
      Object.entries(RAW[kind]).map(([locale, raw]) => {
        const { meta, body } = parseConsentFile(raw);
        const doc: ConsentDoc = {
          kind,
          locale: locale as Locale,
          version: meta.version ?? "",
          effective: meta.effective ?? "",
          reviewedBy: meta.reviewed_by ?? "",
          status: meta.status ?? "",
          translation: meta.translation ?? "",
          body,
        };
        return [locale, doc];
      }),
    ),
  ]),
) as Record<ConsentKind, Record<Locale, ConsentDoc>>;

/** Derived from the files' front matter; importing this module fails if they disagree. */
export const CONSENT_TEXT_VERSION: string = singleVersion(CONSENT_KINDS.flatMap((k) => Object.values(DOCS[k]).map((d) => d.version)));

export function consentText(kind: ConsentKind, locale: Locale): ConsentDoc {
  return DOCS[kind][locale];
}

/** What `BiometricConsent.consentTextVersion` stores, e.g. `SEARCH_SELF:v1-2026-10`. */
export function consentRecordVersion(kind: ConsentKind): string {
  return `${kind}:${CONSENT_TEXT_VERSION}`;
}

export type ConsentBlock = { type: "heading"; text: string } | { type: "paragraph"; text: string } | { type: "list"; items: string[] };

/**
 * The markdown subset the consent files use: `## heading`, `- item` lists and paragraphs
 * (soft-wrapped lines joined). Rendered as plain text, so no HTML ever comes from the files.
 */
export function consentBlocks(body: string): ConsentBlock[] {
  const blocks: ConsentBlock[] = [];
  for (const chunk of body.split(/\r?\n\s*\r?\n/)) {
    const lines = chunk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    if (lines.length === 1 && /^#{1,6}\s/.test(lines[0])) {
      blocks.push({ type: "heading", text: lines[0].replace(/^#{1,6}\s+/, "") });
    } else if (/^[-*]\s/.test(lines[0])) {
      // Lines that do not start a new bullet continue the previous item.
      const items: string[] = [];
      for (const l of lines) {
        if (/^[-*]\s/.test(l)) items.push(l.replace(/^[-*]\s+/, ""));
        else items[items.length - 1] += ` ${l}`;
      }
      blocks.push({ type: "list", items });
    } else {
      blocks.push({ type: "paragraph", text: lines.join(" ") });
    }
  }
  return blocks;
}
