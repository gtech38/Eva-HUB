import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url).pathname });
import { prisma } from "@hub/db";
const ev = await prisma.event.findFirstOrThrow({ where: { slug: "nina-dev" }, include: { domains: true } });
console.log({ slug: ev.slug, domains: ev.domains.map((d) => d.hostname), retention: ev.faceIndexRetentionDays, purgeAt: ev.faceIndexPurgeAt, published: ev.galleryPublishedAt, status: ev.status });
const audit = await prisma.auditLog.findMany({ where: { eventId: ev.id }, orderBy: { createdAt: "desc" }, take: 6 });
console.log(audit.map((a) => `${a.action} ${JSON.stringify(a.data ?? {})}`));
await prisma.$disconnect();
