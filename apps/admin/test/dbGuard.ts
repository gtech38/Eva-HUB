// tdd-exempt: test helper shared by the Postgres-backed admin tests; exercised by them (and by running them with CI=1 and no database).
import { describe, it } from "vitest";
import { prisma } from "@hub/db";

/** CI is set (and not "0"/"false"): a skipped database suite would make a green run meaningless there. */
export const inCi = Boolean(process.env.CI) && !["0", "false"].includes(process.env.CI!);

export const DB_SKIP_REASON = "Postgres unreachable at DATABASE_URL; start it with: pnpm infra:up";

/**
 * Probe Postgres once at collection time. Unreachable locally: log and return false so the caller's
 * `describe.skipIf(!up)` skips. Unreachable with CI set: also register a failing test, so the run is red
 * instead of silently skipping the suite (same rule as guests.db.test.ts).
 */
export async function postgresUp(suite: string): Promise<boolean> {
  const up = await prisma.$queryRaw`SELECT 1`.then(() => true, () => false);
  if (!up && inCi) {
    describe(suite, () => {
      it("requires Postgres when CI is set", () => { throw new Error(DB_SKIP_REASON); });
    });
  } else if (!up) {
    console.log(`# ${suite}: ${DB_SKIP_REASON} -- skipping`);
  }
  return up;
}
