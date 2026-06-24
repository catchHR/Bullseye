export const AGG_MAX_EVENTS_PER_BUCKET = 500;
export const DEFAULT_AGG_LOOKBACK_MINUTES = 5;
export const DEFAULT_AGG_MAX_WEBHOOKS_PER_MINUTE = 10;
export const RATE_WINDOW_MS = 60_000;

export type StoredAggEvent = {
  receivedAt: number;
  trigger: string;
  queueName: string;
  job: unknown;
  error: unknown;
};

export function effectiveLookbackMinutes(raw: number | undefined): number {
  return raw ?? DEFAULT_AGG_LOOKBACK_MINUTES;
}

export function effectiveMaxWebhooksPerMinute(raw: number | undefined): number {
  return raw ?? DEFAULT_AGG_MAX_WEBHOOKS_PER_MINUTE;
}

export function filterEventsByLookback(
  events: StoredAggEvent[],
  now: number,
  lookbackMinutes: number,
): StoredAggEvent[] {
  const cutoff = now - lookbackMinutes * 60_000;
  return events.filter((e) => e.receivedAt >= cutoff);
}

/** Timestamps of successful sends in last 60s — pass sorted ascending */
export function trimSendWindow(sendTimestamps: number[], now: number): number[] {
  const cutoff = now - RATE_WINDOW_MS;
  return sendTimestamps.filter((t) => t >= cutoff).sort((a, b) => a - b);
}

export function countSendsInWindow(sendTimestamps: number[], now: number): number {
  return trimSendWindow(sendTimestamps, now).length;
}

/**
 * Earliest time `t` such that fewer than `maxPerMinute` sends fall strictly after `t - 60s`.
 * `sendTimestamps` = trimmed sorted list.
 */
export function nextAllowedSendAt(
  sendTimestamps: number[],
  now: number,
  maxPerMinute: number,
): number | null {
  const trimmed = trimSendWindow(sendTimestamps, now);
  if (trimmed.length < maxPerMinute) {
    return null;
  }
  const oldest = trimmed[0];
  return oldest + RATE_WINDOW_MS;
}

export function aggEventDedupeKey(event: StoredAggEvent): string {
  const job = event.job as { id?: string } | null;
  const id = job && typeof job.id === 'string' ? job.id : '';
  return `${event.receivedAt}\0${event.trigger}\0${event.queueName}\0${id}`;
}
