/**
 * `/build.json`: which build is deployed, so an open page can tell when the
 * scheduled rebuild has replaced it. Holds nothing personal.
 */
export const dynamic = "force-static";

export function GET(): Response {
  return Response.json({ buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "" });
}
