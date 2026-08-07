import { DashboardShell } from "@/components/dashboard-shell";
import { getBriefingPayload } from "@/lib/server/briefing-service";

export const dynamic = "force-dynamic";

export default async function Home() {
  const initialPayload = await getBriefingPayload();
  return <DashboardShell initialPayload={initialPayload} />;
}
