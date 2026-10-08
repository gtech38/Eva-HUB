/**
 * The trusted request host. Middleware (edge) copies `Host` into this request header,
 * overwriting any value the client sent, so handlers that must not be steered by
 * `X-Forwarded-Host` (the publicly cached /og.png) can read the host the router used.
 * Edge-safe: no Node imports.
 */
export const HUB_HOST_HEADER = "x-hub-host";

export function hostOf(hostHeader: string | null): string {
  return (hostHeader ?? "").toLowerCase().split(":")[0];
}
