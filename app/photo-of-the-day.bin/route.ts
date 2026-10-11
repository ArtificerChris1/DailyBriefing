import { dateInTimeZone } from "@/lib/live-weather";
import { fetchPhotoOfDay } from "@/lib/providers/photos/icloud-shared-album";
import { sealBinary } from "@/lib/server/vault";

/**
 * Writes today's shared-album photo, encrypted, to `/photo-of-the-day.bin` at
 * build time. The album's own download links expire within hours, so the image
 * has to be copied into the site rather than linked, and the browser decrypts
 * it after login.
 */
export const dynamic = "force-static";

export async function GET(): Promise<Response> {
  const timeZone = process.env.OPEN_METEO_TIMEZONE?.trim() || "America/Chicago";
  const result = await fetchPhotoOfDay(dateInTimeZone(new Date(), timeZone));
  // A static export cannot skip a route, so without a photo the file is empty;
  // the briefing then omits the card and never requests it.
  const { body } = sealBinary(result?.image ?? new ArrayBuffer(0));
  return new Response(new Uint8Array(body), {
    headers: { "Content-Type": "application/octet-stream" },
  });
}
