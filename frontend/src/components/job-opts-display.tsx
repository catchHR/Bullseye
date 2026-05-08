import { JsonBlock } from '@/components/json-block';
import type { JobRow } from '@/lib/api';
import {
  formatDelayOptTooltip,
  formatEveryMs,
  formatTimestampIso,
  formatTimestampPretty,
} from '@/lib/format';
import { cn } from '@/lib/utils';

/** Stable order for common Bull keys; unknown keys sort after, alphabetically. */
const OPT_KEY_PRIORITY: string[] = [
  'priority',
  'delay',
  'attempts',
  'backoff',
  'lifo',
  'timeout',
  'removeOnComplete',
  'removeOnFail',
  'repeat',
  'jobId',
  'stackTraceLimit',
  'sizeLimit',
  'timestamp',
];

function sortOptKeys(keys: string[]): string[] {
  return [...keys].sort((left, right) => {
    const leftIndex = OPT_KEY_PRIORITY.indexOf(left);
    const rightIndex = OPT_KEY_PRIORITY.indexOf(right);
    const leftRank = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const rightRank = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.localeCompare(right);
  });
}

export function JobOptsDisplay({ opts }: { opts: JobRow['opts'] }) {
  if (opts === null || opts === undefined || typeof opts !== 'object' || Array.isArray(opts)) {
    return <JsonBlock value={opts} />;
  }

  const record = opts as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return <JsonBlock value={opts} />;
  }

  const sortedKeys = sortOptKeys(keys);

  return (
    <div className="min-w-0 max-w-full rounded-md border border-border bg-muted/40 p-3 text-[11px] leading-relaxed">
      <dl className="min-w-0 space-y-3">
        {sortedKeys.map((key) => (
          <div
            key={key}
            className="grid gap-1 border-b border-border/60 pb-3 last:border-0 last:pb-0 sm:grid-cols-[minmax(7rem,10rem)_1fr] sm:gap-4"
          >
            <dt className="shrink-0 pt-0.5 font-medium text-muted-foreground">{key}</dt>
            <dd className="min-w-0">
              <OptValue optKey={key} value={record[key]} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function formatBackoffSummary(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const backoffType = record.type;
  const delayRaw = record.delay;
  if (typeof backoffType !== 'string' || typeof delayRaw !== 'number') {
    return null;
  }
  return `${backoffType} · base delay ${formatEveryMs(delayRaw)} (${delayRaw.toLocaleString('en-US')} ms)`;
}

/** Bull / BullMQ: `age` is seconds; `count` is max jobs to retain. */
function formatRemovePolicySummary(value: unknown): string | null {
  if (value === true) {
    return 'Yes (default retention)';
  }
  if (value === false) {
    return 'No';
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof record.age === 'number' && Number.isFinite(record.age)) {
    parts.push(
      `max age ${formatEveryMs(record.age * 1000)} (${record.age.toLocaleString('en-US')} s)`,
    );
  }
  if (typeof record.count === 'number' && Number.isFinite(record.count)) {
    parts.push(`keep last ${record.count.toLocaleString('en-US')} job(s)`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function OptValue({ optKey, value }: { optKey: string; value: unknown }) {
  if (optKey === 'delay' && typeof value === 'number') {
    return (
      <span
        className={cn(
          'cursor-help font-mono underline decoration-dotted decoration-muted-foreground/70 underline-offset-2',
        )}
        title={formatDelayOptTooltip(value)}
      >
        {value}
      </span>
    );
  }

  if (optKey === 'timestamp' && typeof value === 'number') {
    const isoTitle = formatTimestampIso(value);
    return (
      <span
        className={cn(
          'cursor-help font-mono underline decoration-dotted decoration-muted-foreground/70 underline-offset-2',
        )}
        title={
          isoTitle
            ? `${isoTitle} (UTC)\nBull opts.timestamp: enqueue / job creation time (Unix ms).`
            : undefined
        }
      >
        {value.toLocaleString('en-US')}{' '}
        <span className="text-muted-foreground">({formatTimestampPretty(value)})</span>
      </span>
    );
  }

  if (optKey === 'backoff') {
    const backoffSummary = formatBackoffSummary(value);
    if (backoffSummary != null) {
      return <span className="break-words font-mono leading-snug">{backoffSummary}</span>;
    }
  }

  if (optKey === 'removeOnComplete' || optKey === 'removeOnFail') {
    const removeSummary = formatRemovePolicySummary(value);
    if (removeSummary != null) {
      return <span className="break-words font-mono leading-snug">{removeSummary}</span>;
    }
  }

  if (value !== null && typeof value === 'object') {
    return (
      <JsonBlock
        value={value}
        className="max-h-[min(280px,38vh)] border-0 p-2 text-[10px]"
      />
    );
  }

  return <span className="break-all font-mono">{formatScalar(value)}</span>;
}

function formatScalar(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  return String(value);
}
