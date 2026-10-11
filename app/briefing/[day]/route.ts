import {
  MAX_DAY_OFFSET,
  MIN_DAY_OFFSET,
  shiftDateKey,
} from "@/lib/briefing-window";
import { dateInTimeZone } from "@/lib/live-weather";
import { getBriefingPayload } from "@/lib/server/briefing-service";
import { sealDocument } from "@/lib/server/vault";

/**
 * One encrypted file per page of the day pager, e.g.
 * `/briefing/2026-10-10.json`, written at build time, plus `/briefing/today.json`
 * for whichever day the build ran on. The site has no server, so the pager
 * reads these instead of asking for a day on demand.
 */
export const dynamic = "force-static";
export const dynamicParams = false;

const TODAY = "today.json";

export function generateStaticParams(): { day: string }[] {
  const timeZone = process.env.OPEN_METEO_TIMEZONE?.trim() || "America/Chicago";
  const today = dateInTimeZone(new Date(), timeZone);
  const days: { day: string }[] = [{ day: TODAY }];
  for (let offset = MIN_DAY_OFFSET; offset <= MAX_DAY_OFFSET; offset += 1) {
    days.push({ day: `${shiftDateKey(today, offset)}.json` });
  }
  return days;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ day: string }> },
): Promise<Response> {
  const { day } = await params;
  const payload = await getBriefingPayload(
    day === TODAY ? {} : { date: day.replace(/\.json$/, "") },
  );
  return Response.json(sealDocument(payload));
}
