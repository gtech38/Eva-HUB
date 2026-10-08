/**
 * Single authorization function. Mirrors the matrix in docs/02-users-and-roles.md.
 * Both apps call `can()`; nothing else decides permissions.
 */

export type Principal = {
  userId: string;
  isPlatformAdmin: boolean;
  /** studioId -> role */
  studioRoles: Record<string, "OWNER" | "STAFF">;
  /** eventId -> roles */
  eventRoles: Record<string, Array<"HOST" | "COHOST" | "PLANNER" | "VENDOR" | "STAFF">>;
  /** eventIds where this user has a linked Guest row */
  guestOf: Set<string>;
  /** INVITE_LINK sessions are guest-scoped: no elevated actions ever */
  authMethod: "INVITE_LINK" | "EMAIL_LINK" | "EMAIL_OTP" | "SMS_OTP" | "PASSKEY";
  /** when the user last authenticated (for re-auth gate) */
  authedAt: Date;
};

export type Action =
  | "platform.admin"
  | "studio.manage"           // billing, price sheets, staff, settings, retention
  | "studio.view"
  | "event.create"
  | "event.settings"          // slug, theme, status, face search toggle
  | "event.content.edit"
  | "event.members.manage"
  | "guests.manage"
  | "invites.send"
  | "rsvp.report"             // headcounts and meal totals (vendors: this only)
  | "rsvp.report.names"       // name-level RSVP lists and exports
  | "rsvp.respond"            // own household
  | "registry.manage"
  | "photos.upload"
  | "albums.manage"
  | "photos.hide"
  | "gallery.view"
  | "gallery.view.hostsOnly"
  | "face.search"
  | "favorites"
  | "proofing.edit"
  | "entitlements.grant"
  | "site.view";

export type Resource = { studioId: string; eventId?: string };

const ELEVATED: ReadonlySet<Action> = new Set<Action>([
  "platform.admin", "studio.manage", "studio.view", "event.create", "event.settings",
  "event.content.edit", "event.members.manage", "guests.manage", "invites.send",
  "rsvp.report", "rsvp.report.names", "registry.manage", "photos.upload", "albums.manage", "photos.hide",
  "proofing.edit", "entitlements.grant",
]);

const REAUTH_HOURS = 12;

export function can(p: Principal, action: Action, r: Resource): boolean {
  // Invitation-link sessions can never do elevated actions (forwarded invites).
  if (ELEVATED.has(action)) {
    if (p.authMethod === "INVITE_LINK") return false;
    const ageH = (Date.now() - p.authedAt.getTime()) / 36e5;
    if (ageH > REAUTH_HOURS) return false;
  }

  if (p.isPlatformAdmin) return true;

  const studioRole = p.studioRoles[r.studioId];
  const isOwner = studioRole === "OWNER";
  const isStaff = studioRole === "STAFF";
  const roles = r.eventId ? (p.eventRoles[r.eventId] ?? []) : [];
  const has = (...rs: typeof roles) => rs.some((x) => roles.includes(x));
  const isGuest = r.eventId ? p.guestOf.has(r.eventId) : false;
  const assignedStaff = isStaff && has("STAFF");
  const hostish = has("HOST", "COHOST");

  switch (action) {
    case "platform.admin": return false;
    case "studio.manage": return isOwner;
    case "studio.view": return isOwner || isStaff;
    case "event.create": return isOwner;
    case "event.settings": return isOwner;
    case "event.content.edit": return isOwner || assignedStaff || hostish || has("PLANNER");
    case "event.members.manage": return isOwner || has("HOST");
    case "guests.manage": return isOwner || hostish || has("PLANNER");
    case "invites.send": return isOwner || hostish || has("PLANNER");
    case "rsvp.report": return isOwner || isStaff || hostish || has("PLANNER") || has("VENDOR");
    case "rsvp.report.names": return isOwner || assignedStaff || hostish || has("PLANNER");
    case "rsvp.respond": return isGuest || hostish;
    case "registry.manage": return isOwner || hostish;
    case "photos.upload": return isOwner || assignedStaff;
    case "albums.manage": return isOwner || assignedStaff;
    case "photos.hide": return isOwner || assignedStaff || hostish;
    case "gallery.view": return isOwner || isStaff || hostish || has("PLANNER", "VENDOR") || isGuest;
    case "gallery.view.hostsOnly": return isOwner || isStaff || hostish;
    case "face.search": return hostish || isGuest;
    case "favorites": return hostish || isGuest;
    case "proofing.edit": return hostish;
    case "entitlements.grant": return isOwner;
    case "site.view": return isOwner || isStaff || roles.length > 0 || isGuest;
  }
}
