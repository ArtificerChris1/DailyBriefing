import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

import type { AppleReminderEnvelope } from "@/lib/providers/contracts";
import {
  appleReminderBridgeConfigured,
  appleReminderStorageProblem,
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

function parseEnvelope(value: unknown): AppleReminderEnvelope | undefined {
  const body = record(value);
  if (!body || (body.schemaVersion !== undefined && body.schemaVersion !== 1)) {
    return undefined;
  }
  // Shortcuts collapses a single-element list into the element itself, so a
  // one-reminder export arrives as a bare object rather than an array.
  const rawReminders = Array.isArray(body.reminders)
    ? body.reminders
    : record(body.reminders)
      ? [body.reminders]
      : undefined;
  if (!rawReminders) {
    return undefined;
  }
  const deviceId = boundedString(body.deviceId, 100) ?? "apple-shortcut";
  const exportedAt = isoDate(body.exportedAt) ?? new Date().toISOString();
  const nonce = boundedString(body.nonce, 200);
  if (!nonce || rawReminders.length > 500) {
    return undefined;
  }

  const reminders: AppleReminderEnvelope["reminders"] = [];
  for (const [index, value] of rawReminders.entries()) {
    const item = record(value);
    if (!item) return undefined;
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
    if (
      !title ||
      typeof completed !== "boolean" ||
      (item.due !== undefined && item.due !== null && !due) ||
      (item.listLabel !== undefined && !listLabel)
    ) {
      return undefined;
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

  return { schemaVersion: 1, deviceId, exportedAt, nonce, reminders };
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
  // Checked only after authentication so the setup detail stays private, and
  // before parsing so a misconfigured store fails legibly rather than as a 500.
  const storageProblem = appleReminderStorageProblem();
  if (storageProblem) {
    return NextResponse.json(
      { error: "snapshot_storage_not_configured", detail: storageProblem },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }
  const envelope = parseEnvelope(body);
  if (!envelope) {
    return NextResponse.json(
      { error: "invalid_apple_reminder_snapshot" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await saveAppleReminderEnvelope(envelope);
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
