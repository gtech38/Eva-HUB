// tdd-exempt: boot wiring only; validateRateLimitConfig is tested in packages/shared/src/ratePolicies.test.ts.

/**
 * Next.js calls register() once per server runtime at startup. A malformed RATE_LIMIT_* override or
 * TRUSTED_PROXY_HOPS must stop the deploy here, not surface mid-request (SHR-003).
 */
export async function register() {
  // Positive check on NEXT_RUNTIME so the bundler drops the import from the edge (middleware) build:
  // the limiter needs Prisma and node:crypto.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateRateLimitConfig } = await import("@hub/shared/ratePolicies");
    validateRateLimitConfig();
  }
}
