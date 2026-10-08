/**
 * Opaque keyset cursors for the gallery feeds. A cursor is base64url of `${key}|${id}`:
 * `key` is the photo's `sortKey` (album and favorites feeds) or its match score (My photos),
 * `id` is the row id that breaks ties. The value comes from the browser, so decoding validates
 * its shape and returns null for anything else; callers answer 400 rather than querying with it.
 */

const MAX_KEY = 128;
const MAX_ID = 64;
const ID_SHAPE = /^[A-Za-z0-9_-]+$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const NUMBER_SHAPE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export type KeysetCursor = { sortKey: string | null; id: string };
export type ScoreCursor = { score: number; id: string };

function pack(key: string, id: string): string {
  return Buffer.from(`${key}|${id}`, "utf8").toString("base64url");
}

function unpack(raw: string): { key: string; id: string } | null {
  if (!raw || !BASE64URL.test(raw)) return null;
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const at = text.lastIndexOf("|");
  if (at < 0) return null;
  const key = text.slice(0, at);
  const id = text.slice(at + 1);
  if (key.length > MAX_KEY || CONTROL.test(key)) return null;
  if (id.length === 0 || id.length > MAX_ID || !ID_SHAPE.test(id)) return null;
  return { key, id };
}

export function encodeCursor(c: KeysetCursor): string {
  return pack(c.sortKey ?? "", c.id);
}

export function decodeCursor(raw: string): KeysetCursor | null {
  const p = unpack(raw);
  return p ? { sortKey: p.key === "" ? null : p.key, id: p.id } : null;
}

export function encodeScoreCursor(c: ScoreCursor): string {
  return pack(String(c.score), c.id);
}

export function decodeScoreCursor(raw: string): ScoreCursor | null {
  const p = unpack(raw);
  if (!p || !NUMBER_SHAPE.test(p.key)) return null;
  const score = Number(p.key);
  return Number.isFinite(score) ? { score, id: p.id } : null;
}
