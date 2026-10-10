import type { BriefingItem, ProviderId } from "@/lib/briefing-types";

export interface PullRequest {
  connectionId: string;
  from: string;
  to: string;
  timeZone: string;
  cursor?: string;
  signal?: AbortSignal;
}

export interface PullResult<T extends BriefingItem> {
  items: T[];
  deletedExternalIds: string[];
  nextCursor?: string;
  warnings: string[];
}

export interface AdapterContext {
  clients: ProviderClientFactory;
  clock: { now(): string };
  log: RedactingLogger;
}

export interface ProviderClientFactory {
  forConnection(connectionId: string): Promise<unknown>;
}

export interface RedactingLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface PullAdapter<T extends BriefingItem> {
  readonly provider: ProviderId;
  readonly capability:
    | "calendar"
    | "weather"
    | "sports"
    | "news";
  pull(request: PullRequest, context: AdapterContext): Promise<PullResult<T>>;
}
