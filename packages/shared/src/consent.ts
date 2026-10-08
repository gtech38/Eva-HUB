/// <reference path="./raw.d.ts" />
/**
 * Biometric consent texts. The words a person agrees to live in `legal/consent/v<N>/` as markdown
 * with front matter and are bundled at build time (`?raw` imports), so the UI, the BiometricConsent
 * row and the admin legal page all read the same files. Every published version stays bundled so a
 * stored `KIND:version` can always be shown again; `CURRENT_CONSENT_VERSION` is the one offered now.
 *
 * Server-only by convention: import this from server components, route handlers and server code,
 * and pass the resolved strings/blocks to client components as props. Never import it from a
 * "use client" module (type-only imports are fine), or the texts land in the client bundle.
 *
 * Changing any wording means a new version directory (see legal/consent/README.md).
 */
import { LOCALES, type Locale } from "./i18n.ts";

import v1SearchSelfEn from "../../../legal/consent/v1/search_self.en.md?raw";
import v1SearchSelfTe from "../../../legal/consent/v1/search_self.te.md?raw";
import v1SearchSelfHi from "../../../legal/consent/v1/search_self.hi.md?raw";
import v1SearchGuardianEn from "../../../legal/consent/v1/search_guardian.en.md?raw";
import v1SearchGuardianTe from "../../../legal/consent/v1/search_guardian.te.md?raw";
import v1SearchGuardianHi from "../../../legal/consent/v1/search_guardian.hi.md?raw";
import v1FaceProfileEn from "../../../legal/consent/v1/face_profile.en.md?raw";
import v1FaceProfileTe from "../../../legal/consent/v1/face_profile.te.md?raw";
import v1FaceProfileHi from "../../../legal/consent/v1/face_profile.hi.md?raw";

/** Mirrors the Prisma `ConsentKind` enum (checked at compile time in consent.test.ts). */
export const CONSENT_KINDS = ["SEARCH_SELF", "SEARCH_GUARDIAN", "FACE_PROFILE"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

/** File name stem per kind: `legal/consent/<dir>/<stem>.<locale>.md`. */
export const CONSENT_FILE_STEMS: Record<ConsentKind, string> = {
  SEARCH_SELF: "search_self",
  SEARCH_GUARDIAN: "search_guardian",
  FACE_PROFILE: "face_profile",
};

type RawVersion = Record<ConsentKind, Record<Locale, string>>;

/** Every published version directory, oldest first. Add new directories here; never remove one. */
const BUNDLED: Array<{ dir: string; raw: RawVersion }> = [
  {
    dir: "v1",
    raw: {
      SEARCH_SELF: { en: v1SearchSelfEn, te: v1SearchSelfTe, hi: v1SearchSelfHi },
      SEARCH_GUARDIAN: { en: v1SearchGuardianEn, te: v1SearchGuardianTe, hi: v1SearchGuardianHi },
      FACE_PROFILE: { en: v1FaceProfileEn, te: v1FaceProfileTe, hi: v1FaceProfileHi },
    },
  },
];

/** The directory whose texts are offered to new consents. */
const CURRENT_DIR = "v1";

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
  /** Checkbox label, e.g. the guardian attestation. */
  label: string;
  /** One- or two-sentence summary shown under the checkbox. */
  summary: string;
  body: string;
};

export type ConsentVersion = { dir: string; version: string; docs: Record<ConsentKind, Record<Locale, ConsentDoc>> };

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

/**
 * Parse and validate one version directory. Throws if a file sits in the wrong (kind, locale) slot,
 * lacks a label or summary, or the files disagree on the version.
 */
export function buildConsentVersion(dir: string, raw: RawVersion): ConsentVersion {
  const docs = {} as Record<ConsentKind, Record<Locale, ConsentDoc>>;
  const all: ConsentDoc[] = [];
  for (const kind of CONSENT_KINDS) {
    docs[kind] = {} as Record<Locale, ConsentDoc>;
    for (const locale of LOCALES) {
      const { meta, body } = parseConsentFile(raw[kind][locale]);
      const where = `${dir}/${CONSENT_FILE_STEMS[kind]}.${locale}`;
      if (meta.kind !== kind || meta.locale !== locale) {
        throw new Error(`consent slot ${kind}.${locale} (${dir}) holds a file declaring ${meta.kind}.${meta.locale}`);
      }
      for (const key of ["label", "summary"] as const) {
        if (!meta[key]) throw new Error(`consent file ${where} has no ${key} in its front matter`);
      }
      const doc: ConsentDoc = {
        kind,
        locale,
        version: meta.version ?? "",
        effective: meta.effective ?? "",
        reviewedBy: meta.reviewed_by ?? "",
        status: meta.status ?? "",
        translation: meta.translation ?? "",
        label: meta.label,
        summary: meta.summary,
        body,
      };
      docs[kind][locale] = doc;
      all.push(doc);
    }
  }
  return { dir, version: singleVersion(all.map((d) => d.version)), docs };
}

/** All bundled versions, oldest first. Importing this module fails if any directory is malformed. */
export const CONSENT_VERSIONS: readonly ConsentVersion[] = BUNDLED.map((b) => buildConsentVersion(b.dir, b.raw));

const byVersion = new Map(CONSENT_VERSIONS.map((v) => [v.version, v]));
if (byVersion.size !== CONSENT_VERSIONS.length) throw new Error("two consent directories declare the same version");

/** The version offered to new consents, from the front matter of `CURRENT_DIR`. */
export const CURRENT_CONSENT_VERSION: string = (() => {
  const current = CONSENT_VERSIONS.find((v) => v.dir === CURRENT_DIR);
  if (!current) throw new Error(`current consent directory ${CURRENT_DIR} is not bundled`);
  return current.version;
})();

export function consentText(kind: ConsentKind, locale: Locale, version: string = CURRENT_CONSENT_VERSION): ConsentDoc {
  const v = byVersion.get(version);
  if (!v) throw new Error(`unknown consent version ${version}`);
  return v.docs[kind][locale];
}

/** What `BiometricConsent.consentTextVersion` stores, e.g. `SEARCH_SELF:v1-2026-10`. */
export function consentRecordVersion(kind: ConsentKind, version: string = CURRENT_CONSENT_VERSION): string {
  return `${kind}:${version}`;
}

/** Reverse of `consentRecordVersion`; null for anything that is not `KIND:version`. */
export function parseConsentRecordVersion(value: string): { kind: ConsentKind; version: string } | null {
  const i = value.indexOf(":");
  if (i <= 0) return null;
  const kind = value.slice(0, i);
  const version = value.slice(i + 1);
  if (!version || !(CONSENT_KINDS as readonly string[]).includes(kind)) return null;
  return { kind: kind as ConsentKind, version };
}

/** Docs of a version that counsel has not signed off (`reviewed_by` empty). */
export function unreviewedConsentDocs(version: string = CURRENT_CONSENT_VERSION): ConsentDoc[] {
  return CONSENT_KINDS.flatMap((kind) => LOCALES.map((locale) => consentText(kind, locale, version))).filter((d) => !d.reviewedBy);
}

export type ConsentBlock = { type: "heading"; text: string } | { type: "paragraph"; text: string } | { type: "list"; items: string[] };

const HEADING = /^#{1,6}\s+/;
const BULLET = /^[-*]\s+/;

/**
 * The markdown subset the consent files use: `## heading`, `- item` lists (wrapped lines continue
 * the item) and paragraphs (wrapped lines joined). Rendered as plain text, so no HTML ever comes
 * from the files.
 */
export function consentBlocks(body: string): ConsentBlock[] {
  const blocks: ConsentBlock[] = [];
  let open: { type: "paragraph"; lines: string[] } | { type: "list"; items: string[] } | null = null;
  const flush = () => {
    if (open?.type === "paragraph") blocks.push({ type: "paragraph", text: open.lines.join(" ") });
    if (open?.type === "list") blocks.push({ type: "list", items: open.items });
    open = null;
  };
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flush();
    } else if (HEADING.test(line)) {
      flush();
      blocks.push({ type: "heading", text: line.replace(HEADING, "") });
    } else if (BULLET.test(line)) {
      if (open?.type !== "list") {
        flush();
        open = { type: "list", items: [] };
      }
      open.items.push(line.replace(BULLET, ""));
    } else if (open?.type === "list") {
      open.items[open.items.length - 1] += ` ${line}`;
    } else {
      if (open?.type !== "paragraph") open = { type: "paragraph", lines: [] };
      open.lines.push(line);
    }
  }
  flush();
  return blocks;
}
