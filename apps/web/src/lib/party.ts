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
 * Page content is host-authored JSON, so a photo key could name another tenant's object. Only keys
 * under this event's own prefix (see `keys` in @hub/shared storage) may be presigned.
 */
export function isEventStorageKey(key: string | null | undefined, studioId: string, eventId: string): key is string {
  if (typeof key !== "string") return false;
  if (key.split("/").includes("..")) return false;
  return key.startsWith(`s/${studioId}/e/${eventId}/`);
}
