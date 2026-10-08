// tdd-exempt: boot wiring only; exitOnInvalidRateLimitConfig is tested in packages/shared/src/ratePolicies.test.ts.

/**
 * Next.js calls register() once per server runtime at startup. A malformed RATE_LIMIT_* override or
 * TRUSTED_PROXY_HOPS logs the reason and exits the process with code 1 (SHR-003); throwing here
 * would not stop Next, which keeps serving 500s.
 */
export async function register() {
  // Positive check on NEXT_RUNTIME so the bundler drops the import from the edge (middleware) build:
  // the limiter needs Prisma and node:crypto.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { exitOnInvalidRateLimitConfig } = await import("@hub/shared/ratePolicies");
    exitOnInvalidRateLimitConfig();
  }
}
