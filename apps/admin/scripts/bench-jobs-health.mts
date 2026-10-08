// Times the real dashboard loaders (loadJobHealth) against whatever is in the Job table.
// Used for ADM-022 with 100k seeded rows:  pnpm exec tsx scripts/bench-jobs-health.mts [eventId]
// Read-only. Loads ../../../.env itself (like the other scripts here), so check DATABASE_URL first
// and never point it at a database you care about while seeding.
//
// Seed recipe (psql against a scratch database; 17% of the successes finished in the last hour):
//   INSERT INTO "Job"(type, payload, status, "runAt", attempts, "lockedAt", "finishedAt", "lastError")
//   SELECT 'BENCH_' || (g % 8), jsonb_build_object('eventId', 'bench-event-' || (g % 50)),
//          CASE g % 20 WHEN 0 THEN 'DEAD' WHEN 1 THEN 'QUEUED' WHEN 2 THEN 'QUEUED' ELSE 'SUCCEEDED' END::"JobStatus",
//          CASE g % 20 WHEN 2 THEN now() + interval '1 hour' ELSE now() - interval '2 minutes' END, 1 + (g % 3),
//          f.t - ((500 + random() * 3000) * interval '1 millisecond'),
//          CASE WHEN g % 20 = 1 THEN NULL ELSE f.t END, CASE WHEN g % 20 IN (0, 2) THEN 'boom' END
//     FROM generate_series(1, 100000) g CROSS JOIN LATERAL (SELECT now() - ((CASE WHEN random() + 0 * g < 0.2
//          THEN random() * 3600 ELSE 3600 + random() * 259200 END) * interval '1 second') AS t) f;
//   ANALYZE "Job";   -- clean up with: DELETE FROM "Job" WHERE type LIKE 'BENCH_%';
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
const { prisma } = await import("@hub/db");
const { loadJobHealth } = await import("../src/lib/jobQueries.ts");

const eventId = process.argv[2];
const scope = eventId ? { eventId } : {};
const rows = await prisma.job.count();
console.log(`DATABASE_URL db=${(process.env.DATABASE_URL ?? "").split("/").pop()}  jobs=${rows}  scope=${eventId ?? "platform"}`);

await loadJobHealth(scope); // warm the pool and plans
const ms: number[] = [];
for (let i = 0; i < 15; i++) {
  const t0 = performance.now();
  await loadJobHealth(scope);
  ms.push(performance.now() - t0);
}
ms.sort((a, b) => a - b);
console.log(`loadJobHealth x${ms.length}: min ${ms[0]!.toFixed(0)} ms, median ${ms[7]!.toFixed(0)} ms, max ${ms.at(-1)!.toFixed(0)} ms`);
await prisma.$disconnect();
