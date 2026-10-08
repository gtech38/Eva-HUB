import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url).pathname });
import { prisma } from "@hub/db";
import { storage } from "@hub/shared";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const slug = process.argv[2] ?? "nina-and-dev";
const ev = await prisma.event.findFirstOrThrow({ where: { slug } });
const photos = await prisma.photo.findMany({ where: { eventId: ev.id }, orderBy: { createdAt: "asc" } });
for (const p of photos) {
  const head = await storage.headObject(p.originalKey);
  console.log(`photo ${p.id} ${p.status} ${p.filename} bytes=${p.originalBytes} key=${p.originalKey} sha=${p.checksum.slice(0, 12)}… s3=${head ? `OK ${head.ContentLength}B ${head.ContentType}` : "MISSING"}`);
}
const jobs = await prisma.job.findMany({ where: { type: "PROCESS_PHOTO", payload: { path: ["eventId"], equals: ev.id } }, orderBy: { id: "desc" } });
console.log("PROCESS_PHOTO jobs:", jobs.map((j) => `#${j.id} ${j.status} dedupe=${j.dedupeKey} payload=${JSON.stringify(j.payload)}`));

// Raw presigned PUT via curl (what the browser does when CORS allows it)
const key = storage.keys.original(ev.studioId, ev.id, "smoke-curl", "png");
const url = await storage.presignUpload(key, "image/png");
const tmp = "/private/tmp/claude-501/-Volumes-CORSAIR-flambient-editing-workflow/9aa272ab-0749-4d29-9397-117b819ddf69/scratchpad/tiny.png";
writeFileSync(tmp, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
const code = execSync(`/usr/bin/curl -s -o /dev/null -w "%{http_code}" -X PUT -H "Content-Type: image/png" --data-binary @${tmp} "${url}"`).toString();
const head = await storage.headObject(key);
console.log(`curl presigned PUT → HTTP ${code}; headObject → ${head ? `OK ${head.ContentLength}B` : "MISSING"}`);
await storage.deleteObject(key);
await prisma.$disconnect();
