import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const p = await requireAdmin();
  const studioIds = Object.keys(p.studioRoles);
  if (p.isPlatformAdmin) redirect("/platform");
  if (studioIds.length === 1) redirect(`/studios/${studioIds[0]}`);
  redirect("/studios");
}
