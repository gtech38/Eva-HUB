/**
 * Postgres-backed tests for the job-queue helper. Requires the local stack (pnpm infra:up).
 * Rows use a unique dedupe prefix per run and are removed afterwards.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { enqueue, prisma } from "./index.ts";

const run = `test-${Date.now()}`;
const key = (s: string) => `${run}:${s}`;

after(async () => {
  await prisma.job.deleteMany({ where: { dedupeKey: { startsWith: run } } });
  await prisma.$disconnect();
});

test("enqueue without dedupeKey always creates a new QUEUED job", async () => {
  const a = await enqueue("SEND_MESSAGE", { run, n: 1 });
  const b = await enqueue("SEND_MESSAGE", { run, n: 2 });
  assert.notEqual(a.id, b.id);
  assert.equal(a.status, "QUEUED");
  await prisma.job.deleteMany({ where: { id: { in: [a.id, b.id] } } });
});

test("enqueue with dedupeKey coalesces while QUEUED and refreshes payload/runAt", async () => {
  const later = new Date(Date.now() + 60_000);
  const a = await enqueue("CLUSTER_FACES", { eventId: "e1" }, { dedupeKey: key("cluster"), runAt: later });
  const b = await enqueue("CLUSTER_FACES", { eventId: "e1", again: true }, { dedupeKey: key("cluster") });
  assert.equal(a.id, b.id, "same row reused");
  assert.deepEqual(b.payload, { eventId: "e1", again: true });
  assert.ok(b.runAt < later, "runAt moved earlier to the new request");
});

test("enqueue with dedupeKey resets a SUCCEEDED job back to QUEUED (matches worker semantics)", async () => {
  const a = await enqueue("PROCESS_PHOTO", { photoId: "p1" }, { dedupeKey: key("process") });
  await prisma.job.update({ where: { id: a.id }, data: { status: "SUCCEEDED", attempts: 1, lastError: "old" } });
  const b = await enqueue("PROCESS_PHOTO", { photoId: "p1" }, { dedupeKey: key("process") });
  assert.equal(b.id, a.id);
  assert.equal(b.status, "QUEUED");
  assert.equal(b.attempts, 0);
  assert.equal(b.lastError, null);
});

test("enqueue with dedupeKey leaves a RUNNING job untouched", async () => {
  const a = await enqueue("BUILD_ZIP", { zipExportId: "z1" }, { dedupeKey: key("zip") });
  await prisma.job.update({ where: { id: a.id }, data: { status: "RUNNING", lockedBy: "w1", lockedAt: new Date() } });
  const b = await enqueue("BUILD_ZIP", { zipExportId: "z1", changed: true }, { dedupeKey: key("zip") });
  assert.equal(b.status, "RUNNING");
  assert.deepEqual(b.payload, { zipExportId: "z1" }, "payload not overwritten mid-run");
});
