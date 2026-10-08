import { redirect } from "next/navigation";
import { getPrincipal } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const p = await getPrincipal();
  if (p && p.authMethod !== "INVITE_LINK" && !sp.reauth) redirect("/");
  const notice =
    sp.reauth ? "For security, sign in again to continue. Admin actions require a sign-in within the last 12 hours." :
    sp.denied ? "This account has no studio or platform access." :
    sp.expired ? "That sign-in link has expired or was already used. Request a new one." :
    sp.signedout ? "You have been signed out." : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <div className="card p-6">
        <div className="mb-5">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">Event Hub</div>
          <h1 className="mt-1 text-xl">Admin sign-in</h1>
          <p className="mt-1 text-xs text-neutral-500">Studio owners, staff and platform admins. We email you a one-time link.</p>
        </div>
        {notice && <p className="mb-4 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">{notice}</p>}
        <LoginForm />
      </div>
      <p className="mt-4 text-center text-[11px] text-neutral-400">Local dev: mail is caught by Mailpit at <a className="underline" href="http://localhost:8025" target="_blank" rel="noreferrer">localhost:8025</a>.</p>
    </main>
  );
}
