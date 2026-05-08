export { formatCronNaturalLanguage } from './cron-natural';

/** Plain-language wording for Bull fixed intervals (`opts.repeat.every`). */
export function formatEveryNaturalLanguage(ms: number | null): string {
  if (ms == null || ms <= 0) {
    return '';
  }
  if (ms >= 86400000) {
    const days = ms / 86400000;
    if (days === 1) {
      return 'Once daily';
    }
    const label = days % 1 === 0 ? String(days) : days.toFixed(1).replace(/\.0$/, '');
    return `Every ${label} days`;
  }
  if (ms >= 3600000) {
    const hours = ms / 3600000;
    const label = hours % 1 === 0 ? String(hours) : hours.toFixed(1).replace(/\.0$/, '');
    return hours === 1 ? 'Hourly' : `Every ${label} hours`;
  }
  if (ms >= 60000) {
    const minutes = ms / 60000;
    const label = minutes % 1 === 0 ? String(minutes) : minutes.toFixed(1).replace(/\.0$/, '');
    return minutes === 1 ? 'Every minute' : `Every ${label} minutes`;
  }
  const seconds = ms / 1000;
  const label = seconds % 1 === 0 ? String(seconds) : seconds.toFixed(1).replace(/\.0$/, '');
  return seconds === 1 ? 'Every second' : `Every ${label} seconds`;
}

export function formatEveryMs(ms: number | null): string {
  if (ms == null || ms <= 0) {
    return '—';
  }
  if (ms >= 86400000) {
    const days = ms / 86400000;
    return `${days % 1 === 0 ? days : days.toFixed(1)}d`;
  }
  if (ms >= 3600000) {
    const hours = ms / 3600000;
    return `${hours % 1 === 0 ? hours : hours.toFixed(1)}h`;
  }
  if (ms >= 60000) {
    const minutes = ms / 60000;
    return `${minutes % 1 === 0 ? minutes : minutes.toFixed(1)}min`;
  }
  const seconds = ms / 1000;
  return `${seconds % 1 === 0 ? seconds : seconds.toFixed(1)}s`;
}

/** Human-readable duration for tooltips (delay ms). */
/** Short duration for tables (job runtime). */
export function formatDurationCompact(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) {
    return '—';
  }
  if (ms < 0) {
    return '—';
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  if (ms < 60000) {
    const seconds = ms / 1000;
    return `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)} s`;
  }
  const minutes = Math.floor(ms / 60000);
  const remainderSeconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${remainderSeconds}s`;
}

export function formatDurationMsEnglish(ms: number): string {
  if (!Number.isFinite(ms)) {
    return String(ms);
  }
  if (ms <= 0) {
    return ms === 0 ? '0 ms' : `${ms} ms`;
  }
  if (ms >= 86400000) {
    const days = ms / 86400000;
    const label = days % 1 === 0 ? String(days) : days.toFixed(1).replace(/\.0$/, '');
    return `${label} day${days === 1 ? '' : 's'}`;
  }
  if (ms >= 3600000) {
    const hours = ms / 3600000;
    const label = hours % 1 === 0 ? String(hours) : hours.toFixed(1).replace(/\.0$/, '');
    return `${label} hour${hours === 1 ? '' : 's'}`;
  }
  if (ms >= 60000) {
    const minutes = ms / 60000;
    const label = minutes % 1 === 0 ? String(minutes) : minutes.toFixed(1).replace(/\.0$/, '');
    return `${label} minute${minutes === 1 ? '' : 's'}`;
  }
  const seconds = ms / 1000;
  const label = seconds % 1 === 0 ? String(seconds) : seconds.toFixed(1).replace(/\.0$/, '');
  return `${label} second${seconds === 1 ? '' : 's'}`;
}

/** Tooltip for Bull `opts.delay` (milliseconds after enqueue, not a Unix timestamp). */
export function formatDelayOptTooltip(ms: number): string {
  const duration = formatDurationMsEnglish(ms);
  return [
    `Bull stores delay in milliseconds (ms), not a Unix timestamp.`,
    `${ms.toLocaleString('en-US')} ms ≈ ${duration} wait before first run.`,
  ].join('\n');
}

/** Pretty date/time for UI (browser locale). */
export function formatTimestampPretty(ms: number | null | undefined): string {
  if (ms == null || ms <= 0) {
    return '—';
  }
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(ms));
  } catch {
    return String(ms);
  }
}

/** Compact clock + date for tight UI (e.g. lifecycle timeline nodes). */
export function formatTimestampTimelineParts(
  ms: number | null | undefined,
): { time: string; date: string } | null {
  if (ms == null || ms <= 0) {
    return null;
  }
  try {
    const date = new Date(ms);
    return {
      time: new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(date),
      date: new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(date),
    };
  } catch {
    return null;
  }
}

/** ISO 8601 (UTC) for `title` / tooltips next to pretty times. */
export function formatTimestampIso(ms: number | null | undefined): string {
  if (ms == null || ms <= 0) {
    return '';
  }
  try {
    return new Date(ms).toISOString();
  } catch {
    return String(ms);
  }
}

export function formatNextRun(timestampMs: number): string {
  return formatTimestampPretty(timestampMs);
}

export function formatProgressValue(progress: unknown): string {
  if (typeof progress === 'number') {
    return String(progress);
  }
  if (progress !== null && typeof progress === 'object') {
    return JSON.stringify(progress);
  }
  return String(progress ?? '');
}
