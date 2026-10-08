import { describe, expect, it } from "vitest";
import { decodeCursor, decodeScoreCursor, encodeCursor, encodeScoreCursor } from "./galleryCursor";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

describe("keyset cursor (sortKey, id)", () => {
  it("round-trips a sortKey and id through base64url", () => {
    const c = { sortKey: "2026-10-08T12:00:00.123", id: "cm1abc23d0000xyz" };
    const raw = encodeCursor(c);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(raw)).toEqual(c);
  });

  it("encodes as base64url of `${sortKey}|${id}`", () => {
    expect(encodeCursor({ sortKey: "a0V", id: "p1" })).toBe(b64("a0V|p1"));
  });

  it("round-trips a null sortKey (photos the worker has not keyed yet)", () => {
    const raw = encodeCursor({ sortKey: null, id: "p9" });
    expect(raw).toBe(b64("|p9"));
    expect(decodeCursor(raw)).toEqual({ sortKey: null, id: "p9" });
  });

  it("keeps a '|' inside the sortKey by splitting on the last separator", () => {
    const c = { sortKey: "a|b", id: "p2" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it.each([
    ["empty string", ""],
    ["not base64url", "!!!"],
    ["no separator", b64("justonepart")],
    ["empty id", b64("2026|")],
    ["id with illegal characters", b64("2026|id with spaces")],
    ["id with SQL-ish characters", b64("2026|x';drop")],
    ["id too long", b64(`2026|${"a".repeat(65)}`)],
    ["sortKey too long", b64(`${"k".repeat(129)}|p1`)],
    ["control character in sortKey", b64("20\n26|p1")],
  ])("rejects a malformed cursor: %s", (_name, raw) => {
    expect(decodeCursor(raw)).toBeNull();
  });
});

describe("score cursor (score desc, id asc) for My photos", () => {
  it("round-trips a score and photo id", () => {
    const c = { score: 0.8123456789012345, id: "photo1" };
    expect(decodeScoreCursor(encodeScoreCursor(c))).toEqual(c);
  });

  it("round-trips integers, tiny values and negatives exactly", () => {
    for (const score of [1, 0, -0.25, 1e-7, 0.1 + 0.2]) {
      expect(decodeScoreCursor(encodeScoreCursor({ score, id: "p" }))?.score).toBe(score);
    }
  });

  it.each([
    ["empty", ""],
    ["non-numeric score", b64("abc|p1")],
    ["NaN", b64("NaN|p1")],
    ["Infinity", b64("Infinity|p1")],
    ["empty score", b64("|p1")],
    ["bad id", b64("0.5|p 1")],
  ])("rejects a malformed score cursor: %s", (_name, raw) => {
    expect(decodeScoreCursor(raw)).toBeNull();
  });
});
