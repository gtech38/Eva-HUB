import { describe, expect, it } from "vitest";
import { eventCopy, hostsPageLabel, EVENT_KINDS } from "./eventCopy.ts";

const LOCALES = ["en", "te", "hi"] as const;
const NON_WEDDING = EVENT_KINDS.filter((k) => k !== "WEDDING");

describe("eventCopy", () => {
  it("wedding copy keeps the marriage wording", () => {
    const c = eventCopy("WEDDING", "en");
    expect(c.eyebrow).toBe("are getting married");
    expect(c.accent).toBe("Married!");
    expect(c.invite).toBe("You're invited");
  });

  it("no non-wedding kind ever says 'married' in any field or locale", () => {
    for (const kind of NON_WEDDING) {
      for (const locale of LOCALES) {
        for (const [field, v] of Object.entries(eventCopy(kind, locale))) {
          expect(v, `${kind}/${locale}/${field}: ${v}`).not.toMatch(/marr/i);
          // An anniversary legitimately names the marriage ("వివాహ వార్షికోత్సవం"); everything else must not.
          if (kind !== "ANNIVERSARY") expect(v, `${kind}/${locale}/${field}: ${v}`).not.toMatch(/పెళ్లి|వివాహ|शादी|विवाह/);
        }
      }
    }
  });

  it("every kind has non-empty copy for every field in every locale", () => {
    for (const kind of EVENT_KINDS) {
      for (const locale of LOCALES) {
        const c = eventCopy(kind, locale);
        for (const field of ["eyebrow", "accent", "invite", "signoff"] as const) {
          expect(c[field].trim().length > 0, `${kind}/${locale}/${field}`).toBe(true);
        }
      }
    }
  });

  it("locale-specific strings are returned, not the English ones", () => {
    expect(eventCopy("WEDDING", "te").eyebrow).toBe("పెళ్లి చేసుకుంటున్నారు");
    expect(eventCopy("CEREMONY", "hi").accent).toBe("शुभाशीष");
    expect(eventCopy("PARTY", "te").invite).not.toBe(eventCopy("PARTY", "en").invite);
  });

  it("the people page is called by the right name per kind", () => {
    expect(hostsPageLabel("WEDDING", "en")).toBe("Wedding Party");
    expect(hostsPageLabel("ENGAGEMENT", "en")).toBe("Wedding Party");
    expect(hostsPageLabel("BABY_SHOWER", "en")).toBe("Hosts");
    expect(hostsPageLabel("PARTY", "en")).toBe("Hosts");
    expect(hostsPageLabel("CEREMONY", "en")).toBe("Family");
    expect(hostsPageLabel("CEREMONY", "te")).toBe("కుటుంబం");
  });
});
