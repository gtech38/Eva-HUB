import { prisma } from "@hub/db";
import { normalizeContact } from "@hub/shared";

/** Find-or-create a user by email. Contact stays unverified until they click a link. */
export async function userForEmail(emailRaw: string, displayName?: string | null) {
  const c = normalizeContact(emailRaw);
  if (!c || c.kind !== "EMAIL") throw new Error("Invalid email");
  const cp = await prisma.contactPoint.findUnique({ where: { kind_value: { kind: "EMAIL", value: c.value } } });
  if (cp) return prisma.user.findUniqueOrThrow({ where: { id: cp.userId } });
  return prisma.user.create({ data: { displayName: displayName ?? null, status: "UNCLAIMED", contactPoints: { create: { kind: "EMAIL", value: c.value, isPrimary: true } } } });
}
