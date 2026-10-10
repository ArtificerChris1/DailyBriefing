import { DashboardShell } from "@/components/dashboard-shell";
import { getBriefingPayload } from "@/lib/server/briefing-service";

// Rendered once at build time; the scheduled rebuild keeps it current.
export default async function Home() {
  const initialPayload = await getBriefingPayload();
  return <DashboardShell initialPayload={initialPayload} />;
}
