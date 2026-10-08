/**
 * DB-backed registry operations. Every query is scoped by eventId (RegistryItem has no studioId;
 * the event is the tenant boundary). The rules themselves live in registry.ts.
 *
 * Database errors (lock timeouts, P2028 transaction-start timeouts, connection loss) are caught
 * here and reported as a refusal, so a server action never surfaces an unhandled exception.
 */
import { prisma } from "@hub/db";
import { CLAIM_DEDUPE_WINDOW_MS, UNDO_WINDOW_MS, checkClaim, remainingQuantity } from "./registry.ts";

export type ClaimResult =
  | { ok: true; claimId: string; remaining: number }
  | { ok: false; reason: "not_found" | "invalid_quantity" | "sold_out" | "failed" }
  | { ok: false; reason: "exceeds_remaining"; remaining: number };

export type ClaimInput = {
  eventId: string;
  studioId: string;
  itemId: string;
  userId: string;
  guestName: string | null;
  quantity: number;
  /** Injectable clock for tests. */
  now?: Date;
};

/**
 * Create a claim unless it would take the item past its quantity. The item row is locked
 * (SELECT ... FOR UPDATE) for the transaction so two guests claiming the last unit serialize
 * instead of both reading the same remaining count. The same lock makes a double submit safe:
 * a second claim by the same user on the same item for the same quantity within
 * CLAIM_DEDUPE_WINDOW_MS returns the first claim (idempotent success) instead of creating another.
 */
export async function claimRegistryItem(input: ClaimInput): Promise<ClaimResult> {
  const { eventId, studioId, itemId, userId, guestName, quantity, now = new Date() } = input;
  // Validate before anything can be mistaken for a duplicate: a bad quantity is never an idempotent success.
  if (!Number.isInteger(quantity) || quantity < 1) return { ok: false, reason: "invalid_quantity" };
  try {
    return await prisma.$transaction(async (tx): Promise<ClaimResult> => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "RegistryItem" WHERE "id" = ${itemId} AND "eventId" = ${eventId} FOR UPDATE`;
      if (locked.length === 0) return { ok: false, reason: "not_found" };

      const item = await tx.registryItem.findFirst({
        where: { id: itemId, eventId },
        select: { quantity: true, claims: { select: { id: true, quantity: true, userId: true, claimedAt: true } } },
      });
      if (!item) return { ok: false, reason: "not_found" };

      const since = now.getTime() - CLAIM_DEDUPE_WINDOW_MS;
      // A double submit repeats the same request: same user, same item, same quantity. A different quantity is a new claim.
      const duplicate = item.claims.find((c) => c.userId === userId && c.quantity === quantity && c.claimedAt.getTime() >= since);
      if (duplicate) return { ok: true, claimId: duplicate.id, remaining: remainingQuantity(item, item.claims) };

      const check = checkClaim(item, item.claims, quantity);
      if (!check.ok) return check;

      const created = await tx.registryClaim.create({ data: { itemId, userId, guestName, quantity: check.quantity }, select: { id: true } });
      await tx.auditLog.create({
        data: { studioId, eventId, actorUserId: userId, action: "registry.claim", target: itemId, data: { claimId: created.id, quantity: check.quantity } },
      });
      return { ok: true, claimId: created.id, remaining: remainingQuantity(item, [...item.claims, { quantity: check.quantity }]) };
    });
  } catch (err) {
    console.error("registry.claim failed", { eventId, itemId, err });
    return { ok: false, reason: "failed" };
  }
}

/**
 * Delete the caller's own claim within the undo window. One conditional delete, so the
 * ownership, window and tenant checks cannot race with the write; the audit row is only
 * written (in the same transaction) when a row was actually deleted.
 */
export async function undoRegistryClaim(input: { eventId: string; studioId: string; claimId: string; userId: string; now?: Date }): Promise<{ ok: boolean }> {
  const { eventId, studioId, claimId, userId, now = new Date() } = input;
  try {
    return await prisma.$transaction(async (tx) => {
      const itemRow = await tx.registryClaim.findFirst({ where: { id: claimId, userId, item: { eventId } }, select: { itemId: true } });
      const { count } = await tx.registryClaim.deleteMany({
        where: {
          id: claimId,
          userId,
          claimedAt: { gte: new Date(now.getTime() - UNDO_WINDOW_MS) },
          item: { eventId },
        },
      });
      if (count !== 1) return { ok: false };
      await tx.auditLog.create({
        data: { studioId, eventId, actorUserId: userId, action: "registry.unclaim", target: itemRow?.itemId ?? null, data: { claimId } },
      });
      return { ok: true };
    });
  } catch (err) {
    console.error("registry.unclaim failed", { eventId, claimId, err });
    return { ok: false };
  }
}

/** Everything the /registry page renders, scoped to one event. */
export async function loadRegistry(eventId: string) {
  const [items, funds] = await Promise.all([
    prisma.registryItem.findMany({
      where: { eventId },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      include: { claims: { select: { id: true, quantity: true, userId: true, claimedAt: true } } },
    }),
    prisma.cashFund.findMany({ where: { eventId }, orderBy: { id: "asc" } }),
  ]);
  return { items, funds };
}
