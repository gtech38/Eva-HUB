"use server";
// tdd-exempt: thin wiring (requireViewer + can + one lib call + revalidatePath); the rules are tested in lib/registry.test.ts and lib/registryClaims.test.ts.

import { revalidatePath } from "next/cache";
import { ui } from "@hub/shared/i18n";
import { requireViewer, page } from "@/lib/site";
import { fullName } from "@/lib/format";
import { claimGate, claimMessageKey } from "@/lib/registry";
import { claimRegistryItem, undoRegistryClaim } from "@/lib/registryClaims";

export type RegistryActionResult = { ok: true } | { ok: false; message: string };

/** Guest marks `quantity` of an item as purchased. Identity comes from the session, never from the form. */
export async function claimItem(itemId: string, quantity: number): Promise<RegistryActionResult> {
  const site = await requireViewer();
  if (!site) return { ok: false, message: "" };
  const { viewer, event, locale } = site;
  if (!viewer.can("registry.claim")) return { ok: false, message: ui(claimMessageKey("forbidden"), locale) };
  // Actions bypass the layout, so repeat its rules: page enabled and event live.
  const gate = claimGate({ registryEnabled: !!page(site, "REGISTRY"), eventStatus: event.status });
  if (gate) return { ok: false, message: ui(claimMessageKey(gate), locale) };

  const guestName = viewer.guest ? fullName(viewer.guest, viewer.principal.displayName ?? "Guest") : (viewer.principal.displayName ?? null);
  const res = await claimRegistryItem({
    eventId: event.id,
    studioId: event.studioId,
    itemId: String(itemId),
    userId: viewer.principal.userId,
    guestName,
    quantity: Number(quantity),
  });
  if (!res.ok) return { ok: false, message: ui(claimMessageKey(res.reason), locale) };

  revalidatePath("/registry");
  return { ok: true };
}

/** Guest takes back their own claim within 24 h. */
export async function undoClaim(claimId: string): Promise<RegistryActionResult> {
  const site = await requireViewer();
  if (!site) return { ok: false, message: "" };
  const { viewer, event, locale } = site;
  if (!viewer.can("registry.claim")) return { ok: false, message: ui(claimMessageKey("forbidden"), locale) };
  const gate = claimGate({ registryEnabled: !!page(site, "REGISTRY"), eventStatus: event.status });
  if (gate) return { ok: false, message: ui(claimMessageKey(gate), locale) };

  const res = await undoRegistryClaim({ eventId: event.id, studioId: event.studioId, claimId: String(claimId), userId: viewer.principal.userId });
  if (!res.ok) return { ok: false, message: ui(claimMessageKey("not_found"), locale) };

  revalidatePath("/registry");
  return { ok: true };
}
