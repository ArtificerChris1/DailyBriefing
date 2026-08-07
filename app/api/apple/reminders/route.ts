import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

import type { AppleReminderEnvelope } from "@/lib/providers/contracts";
import {
  appleReminderBridgeConfigured,
  saveAppleReminderEnvelope,
  verifyAppleShortcutToken,
} from "@/lib/server/apple-reminders-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function boundedString(
  value: unknown,
  maximumLength: number,
): string | undefined {
  return typeof value === "string" && value.trim() && value.length <= maximumLength
    ? value.trim()
    : undefined;
}

function isoDate(value: unknown): string | undefined {
  const text = boundedString(value, 100);
  return text && !Number.isNaN(Date.parse(text))
    ? new Date(text).toISOString()
    : undefined;
}

// TEMPORARY DIAGNOSTIC: reports which field failed validation so the iPhone
// Shortcut can be debugged from its response. Revert once the Shortcut works.
type ParseResult =
  | { ok: true; envelope: AppleReminderEnvelope }
  | { ok: false; reason: string };

function describe(value: unknown): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(len=${value.length})`;
  return `${typeof value} ${JSON.stringify(value)?.slice(0, 80)}`;
}

function parseEnvelope(value: unknown): ParseResult {
  const body = record(value);
  if (!body) {
    return { ok: false, reason: `body must be a JSON object, got ${describe(value)}` };
  }
  if (body.schemaVersion !== undefined && body.schemaVersion !== 1) {
    return {
      ok: false,
      reason: `schemaVersion must be the NUMBER 1, got ${describe(body.schemaVersion)}`,
    };
  }
  if (!Array.isArray(body.reminders)) {
    return {
      ok: false,
      reason: `reminders must be an array, got ${describe(body.reminders)}`,
    };
  }
  const deviceId = boundedString(body.deviceId, 100) ?? "apple-shortcut";
  const exportedAt = isoDate(body.exportedAt) ?? new Date().toISOString();
  const nonce = boundedString(body.nonce, 200);
  if (!nonce) {
    return {
      ok: false,
      reason: `nonce must be a non-empty string (max 200 chars), got ${describe(body.nonce)}`,
    };
  }
  if (body.reminders.length > 500) {
    return { ok: false, reason: `too many reminders: ${body.reminders.length} (max 500)` };
  }

  const reminders: AppleReminderEnvelope["reminders"] = [];
  for (const [index, value] of body.reminders.entries()) {
    const item = record(value);
    if (!item) {
      return {
        ok: false,
        reason: `reminders[${index}] must be an object, got ${describe(value)} — a nested array here means the Shortcut wrapped Repeat Results instead of assigning it`,
      };
    }
    const title = boundedString(item.title, 500);
    const due = item.due === undefined || item.due === null ? undefined : isoDate(item.due);
    const listLabel =
      item.listLabel === undefined
        ? undefined
        : boundedString(item.listLabel, 200);
    const externalId =
      boundedString(item.externalId, 500) ??
      `shortcut-${createHash("sha256")
        .update(`${listLabel ?? ""}\0${title ?? ""}\0${due ?? ""}\0${index}`)
        .digest("base64url")}`;
    const modifiedAt = isoDate(item.modifiedAt) ?? exportedAt;
    const completed = item.completed === undefined ? false : item.completed;
    if (!title) {
      return {
        ok: false,
        reason: `reminders[${index}].title must be a non-empty string, got ${describe(item.title)}`,
      };
    }
    if (typeof completed !== "boolean") {
      return {
        ok: false,
        reason: `reminders[${index}].completed must be a BOOLEAN, got ${describe(item.completed)}`,
      };
    }
    if (item.due !== undefined && item.due !== null && !due) {
      return {
        ok: false,
        reason: `reminders[${index}].due must be a parseable date, got ${describe(item.due)}`,
      };
    }
    if (item.listLabel !== undefined && !listLabel) {
      return {
        ok: false,
        reason: `reminders[${index}].listLabel must be a non-empty string, got ${describe(item.listLabel)}`,
      };
    }
    reminders.push({
      externalId,
      title,
      due,
      completed,
      listLabel,
      modifiedAt,
    });
  }

  return { ok: true, envelope: { schemaVersion: 1, deviceId, exportedAt, nonce, reminders } };
}

function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : undefined;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!appleReminderBridgeConfigured()) {
    return NextResponse.json(
      { error: "apple_reminder_bridge_not_configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!verifyAppleShortcutToken(bearerToken(request))) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }
  const parsed = parseEnvelope(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "invalid_apple_reminder_snapshot", detail: parsed.reason },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await saveAppleReminderEnvelope(parsed.envelope);
    return NextResponse.json(
      { accepted: true, count: result.count, receivedAt: result.receivedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const replayed =
      error instanceof Error && error.message.includes("already received");
    return NextResponse.json(
      { error: replayed ? "duplicate_snapshot" : "snapshot_store_failed" },
      {
        status: replayed ? 409 : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
