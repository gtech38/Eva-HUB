import { test } from "node:test";
import assert from "node:assert/strict";
import { eventCopy, hostsPageLabel, EVENT_KINDS } from "./eventCopy.ts";

const LOCALES = ["en", "te", "hi"] as const;
const NON_WEDDING = EVENT_KINDS.filter((k) => k !== "WEDDING");

test("wedding copy keeps the marriage wording", () => {
  const c = eventCopy("WEDDING", "en");
  assert.equal(c.eyebrow, "are getting married");
  assert.equal(c.accent, "Married!");
  assert.equal(c.invite, "You're invited");
});

test("no non-wedding kind ever says 'married' in any field or locale", () => {
  for (const kind of NON_WEDDING) {
    for (const locale of LOCALES) {
      for (const [field, v] of Object.entries(eventCopy(kind, locale))) {
        assert.doesNotMatch(v, /marr/i, `${kind}/${locale}/${field}: ${v}`);
        // An anniversary legitimately names the marriage ("వివాహ వార్షికోత్సవం"); everything else must not.
        if (kind !== "ANNIVERSARY") assert.doesNotMatch(v, /పెళ్లి|వివాహ|शादी|विवाह/, `${kind}/${locale}/${field}: ${v}`);
      }
    }
  }
});

test("every kind has non-empty copy for every field in every locale", () => {
  for (const kind of EVENT_KINDS) {
    for (const locale of LOCALES) {
      const c = eventCopy(kind, locale);
      for (const field of ["eyebrow", "accent", "invite", "signoff"] as const) {
        assert.ok(c[field].trim().length > 0, `${kind}/${locale}/${field}`);
      }
    }
  }
});

test("locale-specific strings are returned, not the English ones", () => {
  assert.equal(eventCopy("WEDDING", "te").eyebrow, "పెళ్లి చేసుకుంటున్నారు");
  assert.equal(eventCopy("CEREMONY", "hi").accent, "शुभाशीष");
  assert.notEqual(eventCopy("PARTY", "te").invite, eventCopy("PARTY", "en").invite);
});

test("the people page is called by the right name per kind", () => {
  assert.equal(hostsPageLabel("WEDDING", "en"), "Wedding Party");
  assert.equal(hostsPageLabel("ENGAGEMENT", "en"), "Wedding Party");
  assert.equal(hostsPageLabel("BABY_SHOWER", "en"), "Hosts");
  assert.equal(hostsPageLabel("PARTY", "en"), "Hosts");
  assert.equal(hostsPageLabel("CEREMONY", "en"), "Family");
  assert.equal(hostsPageLabel("CEREMONY", "te"), "కుటుంబం");
});
