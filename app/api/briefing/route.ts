import { NextResponse } from "next/server";

import type { CurrentLocationInput } from "@/lib/briefing-types";
import { isDateKey } from "@/lib/briefing-window";
import { getBriefingPayload } from "@/lib/server/briefing-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const requestedDate = new URL(request.url).searchParams.get("date");
  const payload = await getBriefingPayload({
    date: isDateKey(requestedDate) ? requestedDate : undefined,
  });
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function locationFromBody(value: unknown): CurrentLocationInput | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  const location: CurrentLocationInput = {};
  if (typeof body.latitude === "number" && Number.isFinite(body.latitude)) {
    location.latitude = body.latitude;
  }
  if (typeof body.longitude === "number" && Number.isFinite(body.longitude)) {
    location.longitude = body.longitude;
  }
  if (typeof body.timeZone === "string" && body.timeZone.length <= 100) {
    location.timeZone = body.timeZone;
  }
  return location;
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_location_request" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const requestedDate =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).date
      : undefined;
  const payload = await getBriefingPayload({
    location: locationFromBody(body),
    date: isDateKey(requestedDate) ? requestedDate : undefined,
  });
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
