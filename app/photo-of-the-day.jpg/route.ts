import { dateInTimeZone } from "@/lib/live-weather";
import { fetchPhotoOfDay } from "@/lib/providers/photos/icloud-shared-album";

/**
 * Writes today's shared-album photo to `/photo-of-the-day.jpg` at build time.
 * The album's own download links expire within hours, so the image has to be
 * copied into the site rather than linked.
 */
export const dynamic = "force-static";

/**
 * A 1x1 transparent GIF. A static export cannot skip a route, so without a
 * photo the file still exists; the briefing omits the card and never shows it.
 */
const PLACEHOLDER = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export async function GET(): Promise<Response> {
  const timeZone = process.env.OPEN_METEO_TIMEZONE?.trim() || "America/Chicago";
  const result = await fetchPhotoOfDay(dateInTimeZone(new Date(), timeZone));
  return result
    ? new Response(result.image, { headers: { "Content-Type": "image/jpeg" } })
    : new Response(PLACEHOLDER, { headers: { "Content-Type": "image/gif" } });
}
