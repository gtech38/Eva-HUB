import { prisma, type Prisma } from "@hub/db";

export async function audit(entry: {
  studioId?: string | null;
  eventId?: string | null;
  actorUserId?: string | null;
  action: string;
  target?: string | null;
  data?: Prisma.InputJsonValue;
}) {
  await prisma.auditLog.create({
    data: {
      studioId: entry.studioId ?? null,
      eventId: entry.eventId ?? null,
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      target: entry.target ?? null,
      data: entry.data,
    },
  });
}
