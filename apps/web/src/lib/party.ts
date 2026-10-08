/** Pure helpers for the Wedding Party page: grouping by role and guarding host-authored storage keys. */
import { t, type Locale, type LocalizedText } from "@hub/shared/i18n";

export type PartyMember = { name: string; role: LocalizedText; photoKey: string | null; blurb: LocalizedText };
export type PartyGroup<M extends Pick<PartyMember, "role"> = PartyMember> = { role: string; members: M[] };

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Group members by their role text in the viewer's locale. Groups keep first-seen order (the host
 * orders the list); members without any role come last under an empty heading.
 */
export function groupByRole<M extends Pick<PartyMember, "role">>(members: readonly M[], locale: Locale): PartyGroup<M>[] {
  const named = new Map<string, PartyGroup<M>>();
  const unnamed: M[] = [];
  for (const member of members) {
    const role = t(member.role, locale).trim();
    if (!role) {
      unnamed.push(member);
      continue;
    }
    const key = norm(role);
    const group = named.get(key);
    if (group) group.members.push(member);
    else named.set(key, { role, members: [member] });
  }
  const groups = [...named.values()];
  if (unnamed.length) groups.push({ role: "", members: unnamed });
  return groups;
}

/**
 * Page content is host-authored JSON, so a photo key could name anything in the bucket. Only
 * site assets (`s/{studio}/e/{event}/site/...`, see `keys.hero` in @hub/shared storage) may be
 * presigned for every guest: not another tenant's objects, and not this event's own `orig/`,
 * `d/` (derivatives of possibly hidden or unentitled photos) or `zip/` objects, which would
 * bypass album visibility and `isEntitledFullRes`.
 */
export function isEventSiteKey(key: string | null | undefined, studioId: string, eventId: string): key is string {
  if (typeof key !== "string") return false;
  const prefix = `s/${studioId}/e/${eventId}/site/`;
  if (!key.startsWith(prefix)) return false;
  // Allowlist for everything after the prefix: plain name segments only. No dots-only segments,
  // no percent-encoding, empty segments, trailing slash, control characters or non-ASCII, so
  // nothing a CDN or proxy in front of storage might normalise into traversal can get through.
  return SITE_KEY_REST.test(key.slice(prefix.length));
}

const SITE_KEY_REST = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
