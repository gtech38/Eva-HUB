import { env } from "@hub/shared/env";

export const dynamic = "force-dynamic";

export default function RootPage() {
  const e = env();
  return (
    <main className="mx-auto max-w-xl px-4 py-24 font-body">
      <p className="eyebrow mb-3">Event Hub</p>
      <h1 className="font-display text-3xl">This is the guest-facing web app.</h1>
      <p className="mt-4 text-muted">
        Event sites live on their own hostnames, for example{" "}
        <a className="underline" href={`http://priya-arjun.${e.ROOT_DOMAIN}:${e.WEB_PORT}`}>
          priya-arjun.{e.ROOT_DOMAIN}:{e.WEB_PORT}
        </a>
        . The studio and host dashboards live in the admin app on{" "}
        <a className="underline" href={e.ADMIN_ORIGIN}>
          {e.ADMIN_ORIGIN.replace(/^https?:\/\//, "")}
        </a>
        .
      </p>
    </main>
  );
}
