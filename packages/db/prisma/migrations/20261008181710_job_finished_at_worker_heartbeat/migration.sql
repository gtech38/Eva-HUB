-- ADM-022 (jobs dashboard health). Apply before starting a worker built with the finishedAt writes.
--   Job.finishedAt     end of the latest attempt: stamped on success and on every failure, not on a Requeue;
--                      cleared when a job is re-queued for a fresh run. NULL on rows from before this migration.
--   WorkerHeartbeat    one row per consumer process, upserted every 10 s by its heartbeat thread;
--                      live = lastSeenAt within 30 s. No index on lastSeenAt on purpose (keeps the update HOT).

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "finishedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "workerId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" TEXT,
    "hostname" TEXT,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("workerId")
);
