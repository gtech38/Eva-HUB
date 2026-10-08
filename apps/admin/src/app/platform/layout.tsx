import { requirePlatformAdmin, visibleStudios } from "@/lib/auth";
import { Shell } from "@/components/Shell";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const p = await requirePlatformAdmin();
  const studios = await visibleStudios(p);
  return <Shell principal={p} studios={studios} sections={[]}>{children}</Shell>;
}
