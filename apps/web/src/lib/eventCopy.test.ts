import { test } from "node:test";
import assert from "node:assert/strict";
import { eventCopy, hostsPageLabel } from "./eventCopy.ts";

test("wedding copy keeps the marriage wording", () => {
  const c = eventCopy("WEDDING", "en");
  assert.equal(c.eyebrow, "are getting married");
  assert.equal(c.accent, "Married!");
  assert.equal(c.invite, "You're invited");
});

test("baby shower, birthday, ceremony and party never say 'married'", () => {
  for (const kind of ["BABY_SHOWER", "BIRTHDAY", "CEREMONY", "PARTY", "ANNIVERSARY", "ENGAGEMENT", "CORPORATE", "OTHER"] as const) {
    const c = eventCopy(kind, "en");
    for (const v of Object.values(c)) assert.doesNotMatch(v, /marr/i, `${kind}: ${v}`);
  }
});

test("every kind has copy in every locale, falling back to English where a translation is missing", () => {
  for (const kind of ["WEDDING", "BABY_SHOWER", "CEREMONY", "PARTY"] as const) {
    for (const locale of ["en", "te", "hi"] as const) {
      const c = eventCopy(kind, locale);
      assert.ok(c.eyebrow.length > 0 && c.accent.length > 0 && c.invite.length > 0, `${kind}/${locale}`);
    }
  }
  assert.equal(eventCopy("WEDDING", "te").eyebrow, "పెళ్లి చేసుకుంటున్నారు");
});

test("the people page is called by the right name per kind", () => {
  assert.equal(hostsPageLabel("WEDDING", "en"), "Wedding Party");
  assert.equal(hostsPageLabel("BABY_SHOWER", "en"), "Hosts");
  assert.equal(hostsPageLabel("PARTY", "en"), "Hosts");
  assert.equal(hostsPageLabel("CEREMONY", "en"), "Family");
});
