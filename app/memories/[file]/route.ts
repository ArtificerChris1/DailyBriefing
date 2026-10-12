import { dateInTimeZone } from "@/lib/live-weather";
import { MAX_MEMORIES, fetchMemories } from "@/lib/providers/photos/icloud-shared-album";
import { sealBinary } from "@/lib/server/vault";

/**
 * Writes today's "on this day" photos, encrypted, to `/memories/0.bin` and on.
 * Every slot is written whether or not it has a photo, because a static export
 * cannot skip a route; the briefing only points at the ones that exist.
 */
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams(): { file: string }[] {
  return Array.from({ length: MAX_MEMORIES }, (_, index) => ({ file: `${index}.bin` }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await params;
  const timeZone = process.env.OPEN_METEO_TIMEZONE?.trim() || "America/Chicago";
  const memories = await fetchMemories(dateInTimeZone(new Date(), timeZone), timeZone);
  const memory = memories[Number(file.replace(/\.bin$/, ""))];
  const { body } = sealBinary(memory?.image ?? new ArrayBuffer(0));
  return new Response(new Uint8Array(body), {
    headers: { "Content-Type": "application/octet-stream" },
  });
}
