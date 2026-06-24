import { Brush } from '@visx/brush';
import type { Bounds } from '@visx/brush/lib/types';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { GridColumns, GridRows } from '@visx/grid';
import { Group } from '@visx/group';
import { ParentSize } from '@visx/responsive';
import { scaleLinear, scaleTime } from '@visx/scale';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { JobRow, JobStatus, JobsQueryStatus } from '@/lib/api';
import { formatDurationCompact, formatTimestampPretty } from '@/lib/format';
import { JOB_STATE_HEATMAP_FILL } from '@/lib/status-styles';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const TIMEFRAME_EXPANDED_KEY = 'bullseye-queue-jobs-timeframe-expanded';
const TIMEFRAME_PRESET_STORAGE_KEY = 'bullseye-queue-jobs-timeframe-preset';

function readTimeframeExpanded(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  return window.localStorage.getItem(TIMEFRAME_EXPANDED_KEY) !== '0';
}

export type TimeframePresetId =
  | 'all_time'
  | 'last_5m'
  | 'last_10m'
  | 'last_15m'
  | 'last_30m'
  | 'last_1h'
  | 'last_3h'
  | 'last_6h'
  | 'last_12h'
  | 'last_24h'
  | 'last_2d'
  | 'last_7d'
  | 'yesterday'
  | 'day_before_yesterday'
  | 'today'
  | 'today_so_far'
  | 'this_week'
  | 'this_week_so_far';

const TIMEFRAME_PRESETS: { id: TimeframePresetId; label: string }[] = [
  { id: 'all_time', label: 'All time' },
  { id: 'last_5m', label: 'Last 5 minutes' },
  { id: 'last_10m', label: 'Last 10 minutes' },
  { id: 'last_15m', label: 'Last 15 minutes' },
  { id: 'last_30m', label: 'Last 30 minutes' },
  { id: 'last_1h', label: 'Last 1 hour' },
  { id: 'last_3h', label: 'Last 3 hours' },
  { id: 'last_6h', label: 'Last 6 hours' },
  { id: 'last_12h', label: 'Last 12 hours' },
  { id: 'last_24h', label: 'Last 24 hours' },
  { id: 'last_2d', label: 'Last 2 days' },
  { id: 'last_7d', label: 'Last 7 days' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'day_before_yesterday', label: 'Day before yesterday' },
  { id: 'today', label: 'Today' },
  { id: 'today_so_far', label: 'Today so far' },
  { id: 'this_week', label: 'This week' },
  { id: 'this_week_so_far', label: 'This week so far' },
];

const PRESET_IDS = new Set(TIMEFRAME_PRESETS.map((p) => p.id));

function readStoredTimeframePreset(): TimeframePresetId {
  if (typeof window === 'undefined') {
    return 'all_time';
  }
  const raw = window.localStorage.getItem(TIMEFRAME_PRESET_STORAGE_KEY);
  if (raw && PRESET_IDS.has(raw as TimeframePresetId)) {
    return raw as TimeframePresetId;
  }
  return 'all_time';
}

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Monday 00:00 local (week containing `now`). */
function startOfLocalWeekMonday(nowMs: number): number {
  const now = new Date(nowMs);
  const dow = now.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(now);
  mon.setDate(now.getDate() + offset);
  return startOfLocalDay(mon).getTime();
}

/** Sunday 23:59:59.999 local for the week that starts on Monday `weekStartMs`. */
function endOfLocalWeekFromMondayStart(weekStartMs: number): number {
  const sun = new Date(weekStartMs);
  sun.setDate(sun.getDate() + 6);
  return endOfLocalDay(sun).getTime();
}

/** X-axis span from the jobs currently loaded into the heatmap (no fixed clock window). */
function computeDataDrivenTimeRange(
  jobs: JobRow[],
  jobStatus: JobsQueryStatus,
  nowMs: number,
): { start: number; end: number } {
  let minT = Number.POSITIVE_INFINITY;
  let maxT = Number.NEGATIVE_INFINITY;
  for (const job of jobs) {
    const c = jobToHeatmapCoords(job, jobStatus, nowMs);
    if (!c) {
      continue;
    }
    minT = Math.min(minT, c.tMs);
    maxT = Math.max(maxT, c.tMs);
  }
  if (!Number.isFinite(minT) || !Number.isFinite(maxT)) {
    return { start: nowMs - 3600_000, end: nowMs };
  }
  if (maxT - minT < 60_000) {
    const mid = (minT + maxT) / 2;
    return { start: mid - 30_000, end: mid + 30_000 };
  }
  return { start: minT, end: maxT };
}

type FixedTimeframePresetId = Exclude<TimeframePresetId, 'all_time'>;

function getFixedPresetTimeRange(preset: FixedTimeframePresetId, nowMs: number): {
  start: number;
  end: number;
} {
  const now = new Date(nowMs);
  switch (preset) {
    case 'last_5m':
      return { start: nowMs - 5 * 60_000, end: nowMs };
    case 'last_10m':
      return { start: nowMs - 10 * 60_000, end: nowMs };
    case 'last_15m':
      return { start: nowMs - 15 * 60_000, end: nowMs };
    case 'last_30m':
      return { start: nowMs - 30 * 60_000, end: nowMs };
    case 'last_1h':
      return { start: nowMs - 3600_000, end: nowMs };
    case 'last_3h':
      return { start: nowMs - 3 * 3600_000, end: nowMs };
    case 'last_6h':
      return { start: nowMs - 6 * 3600_000, end: nowMs };
    case 'last_12h':
      return { start: nowMs - 12 * 3600_000, end: nowMs };
    case 'last_24h':
      return { start: nowMs - 24 * 3600_000, end: nowMs };
    case 'last_2d':
      return { start: nowMs - 2 * 86400_000, end: nowMs };
    case 'last_7d':
      return { start: nowMs - 7 * 86400_000, end: nowMs };
    case 'yesterday': {
      const y = new Date(nowMs);
      y.setDate(y.getDate() - 1);
      return { start: startOfLocalDay(y).getTime(), end: endOfLocalDay(y).getTime() };
    }
    case 'day_before_yesterday': {
      const y = new Date(nowMs);
      y.setDate(y.getDate() - 2);
      return { start: startOfLocalDay(y).getTime(), end: endOfLocalDay(y).getTime() };
    }
    case 'today':
      return { start: startOfLocalDay(now).getTime(), end: endOfLocalDay(now).getTime() };
    case 'today_so_far':
      return { start: startOfLocalDay(now).getTime(), end: nowMs };
    case 'this_week': {
      const start = startOfLocalWeekMonday(nowMs);
      return { start, end: endOfLocalWeekFromMondayStart(start) };
    }
    case 'this_week_so_far':
      return { start: startOfLocalWeekMonday(nowMs), end: nowMs };
  }
}

/** X-axis tick label from window length (local time). */
function formatHeatmapXTick(
  value: Date,
  rangeMs: number,
  domainStartMs: number,
  domainEndMs: number,
): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = pad(value.getHours());
  const m = pad(value.getMinutes());
  if (rangeMs <= 6 * 3600_000) {
    const sameDay =
      new Date(domainStartMs).toDateString() === new Date(domainEndMs).toDateString();
    if (sameDay) {
      return `${h}:${m}`;
    }
    return `${value.getMonth() + 1}/${value.getDate()} ${h}:${m}`;
  }
  if (rangeMs <= 48 * 3600_000) {
    return `${value.getMonth() + 1}/${value.getDate()} ${h}:${m}`;
  }
  if (rangeMs <= 14 * 86400_000) {
    return value.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  const y = value.getFullYear();
  const thisY = new Date().getFullYear();
  return value.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(y !== thisY ? { year: 'numeric' as const } : {}),
  });
}

function xAxisNumTicks(rangeMs: number, innerWidth: number): number {
  const w = Math.max(120, innerWidth);
  const base =
    rangeMs <= 3600_000 ? 5 : rangeMs <= 6 * 3600_000 ? 6 : rangeMs <= 48 * 3600_000 ? 7 : rangeMs <= 7 * 86400_000 ? 7 : 8;
  return Math.min(base, Math.max(4, Math.floor(w / 72)));
}

const BLOCK = 5;
const MARGIN = { top: 8, left: 56, right: 10, bottom: 42 };

export type TimeframeBrush = {
  tMin: number;
  tMax: number;
  dMin: number;
  dMax: number;
};

/** Maps visx brush domain to numeric timeframe + duration window. */
export function brushDomainFromVisxBounds(bounds: Bounds | null): TimeframeBrush | null {
  if (!bounds) {
    return null;
  }
  const toNum = (v: unknown): number => {
    if (v instanceof Date) {
      return v.getTime();
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : Number.NaN;
  };
  const x0 = toNum(bounds.x0);
  const x1 = toNum(bounds.x1);
  const y0 = toNum(bounds.y0);
  const y1 = toNum(bounds.y1);
  if (![x0, x1, y0, y1].every(Number.isFinite)) {
    return null;
  }
  const tMin = Math.min(x0, x1);
  const tMax = Math.max(x0, x1);
  const dMin = Math.min(y0, y1);
  const dMax = Math.max(y0, y1);
  if (tMax - tMin < 2 || dMax - dMin < 0.5) {
    return null;
  }
  return { tMin, tMax, dMin, dMax };
}

function effectiveJobState(job: JobRow, jobStatus: JobsQueryStatus): JobStatus {
  if (jobStatus !== 'all') {
    return jobStatus;
  }
  if (job.state) {
    return job.state;
  }
  if (job.failedReason?.trim()) {
    return 'failed';
  }
  return 'waiting';
}

export function jobToHeatmapCoords(
  job: JobRow,
  jobStatus: JobsQueryStatus,
  nowMs: number,
): { tMs: number; durationMs: number; stateForColor: JobStatus } | null {
  const processedOn = job.processedOn;
  const finishedOn = job.finishedOn;
  let durationMs = 0;
  if (processedOn != null && finishedOn != null && finishedOn >= processedOn) {
    durationMs = finishedOn - processedOn;
  } else if (processedOn != null && finishedOn == null) {
    durationMs = Math.max(0, nowMs - processedOn);
  }

  const tMs = finishedOn ?? processedOn ?? job.timestamp;
  if (!Number.isFinite(tMs) || tMs <= 0) {
    return null;
  }

  const stateForColor = effectiveJobState(job, jobStatus);

  return { tMs, durationMs, stateForColor };
}

export function jobMatchesTimeframeBrush(
  job: JobRow,
  jobStatus: JobsQueryStatus,
  nowMs: number,
  brush: TimeframeBrush,
): boolean {
  const p = jobToHeatmapCoords(job, jobStatus, nowMs);
  if (!p) {
    return false;
  }
  return (
    p.tMs >= brush.tMin &&
    p.tMs <= brush.tMax &&
    p.durationMs >= brush.dMin &&
    p.durationMs <= brush.dMax
  );
}

function percentile(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) {
    return 0;
  }
  const idx = (sortedMs.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) {
    return sortedMs[lo] ?? 0;
  }
  const a = sortedMs[lo] ?? 0;
  const b = sortedMs[hi] ?? a;
  return a + (b - a) * (idx - lo);
}

type HeatmapInnerProps = {
  width: number;
  height: number;
  jobs: JobRow[];
  jobStatus: JobsQueryStatus;
  nowMs: number;
  timeRange: { start: number; end: number };
  onBrushDomain: (brush: TimeframeBrush | null) => void;
};

function QueueJobsTimeframeHeatmapInner({
  width,
  height,
  jobs,
  jobStatus,
  nowMs,
  timeRange,
  onBrushDomain,
}: HeatmapInnerProps) {
  const rangeMs = Math.max(1, timeRange.end - timeRange.start);

  const points = useMemo(() => {
    const list: {
      job: JobRow;
      tMs: number;
      durationMs: number;
      stateForColor: JobStatus;
    }[] = [];
    for (const job of jobs) {
      const c = jobToHeatmapCoords(job, jobStatus, nowMs);
      if (!c) {
        continue;
      }
      if (c.tMs < timeRange.start || c.tMs > timeRange.end) {
        continue;
      }
      list.push({ job, ...c });
    }
    return list;
  }, [jobs, jobStatus, nowMs, timeRange.start, timeRange.end]);

  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);

  const { xScale, yScale, p99, maxD } = useMemo(() => {
    const t0 = timeRange.start;
    const t1 = timeRange.end;

    if (innerWidth <= 0 || innerHeight <= 0) {
      const x = scaleTime({
        domain: [new Date(t0), new Date(t1)],
        range: [0, Math.max(1, innerWidth)],
      });
      const y = scaleLinear({
        domain: [0, 1],
        range: [Math.max(1, innerHeight), 0],
      });
      return { xScale: x, yScale: y, p99: 0, maxD: 0 };
    }

    const x = scaleTime({
      domain: [new Date(t0), new Date(t1)],
      range: [0, innerWidth],
    });

    if (points.length === 0) {
      const y = scaleLinear({
        domain: [0, 1],
        range: [innerHeight, 0],
      });
      return { xScale: x, yScale: y, p99: 0, maxD: 0 };
    }

    const durs = points.map((p) => p.durationMs);
    durs.sort((a, b) => a - b);
    const p99v = percentile(durs, 0.99);
    const maxDv = Math.max(1, durs[durs.length - 1] ?? 1, p99v * 1.02);

    const y = scaleLinear({
      domain: [0, maxDv],
      range: [innerHeight, 0],
    });

    return {
      xScale: x,
      yScale: y,
      p99: p99v,
      maxD: maxDv,
    };
  }, [points, innerWidth, innerHeight, timeRange.start, timeRange.end]);

  const bottomNumTicks = useMemo(
    () => xAxisNumTicks(rangeMs, innerWidth),
    [rangeMs, innerWidth],
  );

  const handleBrushEnd = useCallback(
    (bounds: Bounds | null) => {
      onBrushDomain(brushDomainFromVisxBounds(bounds));
    },
    [onBrushDomain],
  );

  if (width < 40 || height < 40) {
    return null;
  }

  return (
    <svg width={width} height={height} className="touch-none text-muted-foreground">
      <Group left={MARGIN.left} top={MARGIN.top}>
        <GridRows
          scale={yScale}
          width={innerWidth}
          strokeDasharray="2,4"
          stroke="currentColor"
          strokeOpacity={0.35}
          pointerEvents="none"
        />
        <GridColumns
          scale={xScale}
          height={innerHeight}
          strokeDasharray="2,4"
          stroke="currentColor"
          strokeOpacity={0.25}
          pointerEvents="none"
        />

        {points.map((p) => {
          const cx = xScale(new Date(p.tMs));
          const cy = yScale(p.durationMs);
          if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
            return null;
          }
          const fill = JOB_STATE_HEATMAP_FILL[p.stateForColor];
          const title = `${p.job.name} · #${p.job.id}\n${formatTimestampPretty(p.tMs)}\n${formatDurationCompact(p.durationMs)}\n${p.stateForColor}`;
          const dedupe =
            p.job.queueName != null && p.job.queueName !== ''
              ? `${p.job.queueName}:${p.job.id}`
              : p.job.id;
          return (
            <rect
              key={`${dedupe}-${p.tMs}`}
              x={cx - BLOCK / 2}
              y={cy - BLOCK / 2}
              width={BLOCK}
              height={BLOCK}
              fill={fill}
              fillOpacity={0.92}
              rx={0.5}
            >
              <title>{title}</title>
            </rect>
          );
        })}

        {p99 > 0 && Number.isFinite(yScale(p99)) ? (
          <line
            x1={0}
            x2={innerWidth}
            y1={yScale(p99)}
            y2={yScale(p99)}
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="4 3"
            strokeOpacity={0.85}
            pointerEvents="none"
          />
        ) : null}

        <Brush
          xScale={xScale}
          yScale={yScale}
          width={innerWidth}
          height={innerHeight}
          margin={{
            top: MARGIN.top,
            left: MARGIN.left,
            right: MARGIN.right,
            bottom: MARGIN.bottom,
          }}
          useWindowMoveEvents
          brushRegion="chart"
          brushDirection="both"
          resizeTriggerAreas={[
            'left',
            'right',
            'top',
            'bottom',
            'topLeft',
            'topRight',
            'bottomLeft',
            'bottomRight',
          ]}
          onBrushEnd={handleBrushEnd}
          handleSize={8}
          disableDraggingSelection={false}
          selectedBoxStyle={{
            fill: 'hsl(var(--primary) / 0.12)',
            stroke: 'hsl(var(--foreground))',
            strokeWidth: 1,
            strokeOpacity: 0.55,
            fillOpacity: 1,
          }}
        />

        <AxisLeft
          scale={yScale}
          tickFormat={(v) => formatDurationCompact(Number(v))}
          tickStroke="currentColor"
          tickLabelProps={{
            fill: 'currentColor',
            fontSize: 9,
            textAnchor: 'end',
            dx: -4,
          }}
        />
      </Group>
      <AxisBottom
        top={innerHeight + MARGIN.top}
        left={MARGIN.left}
        scale={xScale}
        numTicks={bottomNumTicks}
        tickFormat={(v) =>
          formatHeatmapXTick(v as Date, rangeMs, timeRange.start, timeRange.end)
        }
        tickStroke="currentColor"
        tickLabelProps={{
          fill: 'currentColor',
          fontSize: rangeMs > 14 * 86400_000 ? 8 : 9,
          textAnchor: 'middle',
        }}
      />
      <text
        x={MARGIN.left + 4}
        y={14}
        className="fill-foreground text-[10px] font-medium"
      >
        {`↓ ${formatDurationCompact(maxD)} max · ${formatDurationCompact(p99)} p99`}
      </text>
    </svg>
  );
}

export function QueueJobsTimeframeHeatmap({
  jobs,
  jobStatus,
  brush,
  onBrushChange,
  onClearBrush,
  resetKey,
}: {
  jobs: JobRow[];
  jobStatus: JobsQueryStatus;
  brush: TimeframeBrush | null;
  onBrushChange: (next: TimeframeBrush | null) => void;
  onClearBrush: () => void;
  /** Bump to remount Brush after programmatic clear. */
  resetKey: number;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [sectionExpanded, setSectionExpanded] = useState(readTimeframeExpanded);
  const [preset, setPreset] = useState<TimeframePresetId>(() => readStoredTimeframePreset());
  const presetFirstRunRef = useRef(true);

  const timeRange = useMemo(() => {
    if (preset === 'all_time') {
      return computeDataDrivenTimeRange(jobs, jobStatus, nowMs);
    }
    return getFixedPresetTimeRange(preset, nowMs);
  }, [preset, nowMs, jobs, jobStatus]);

  useEffect(() => {
    if (jobStatus !== 'active' && jobStatus !== 'all') {
      return undefined;
    }
    const id = window.setInterval(() => setNowMs(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, [jobStatus]);

  useEffect(() => {
    setNowMs(Date.now());
  }, [jobs, jobStatus]);

  useEffect(() => {
    if (presetFirstRunRef.current) {
      presetFirstRunRef.current = false;
      return;
    }
    onClearBrush();
  }, [preset, onClearBrush]);

  const setPresetPersist = useCallback((next: TimeframePresetId) => {
    setPreset(next);
    window.localStorage.setItem(TIMEFRAME_PRESET_STORAGE_KEY, next);
  }, []);

  const toggleExpanded = useCallback(() => {
    setSectionExpanded((previous) => {
      const next = !previous;
      window.localStorage.setItem(TIMEFRAME_EXPANDED_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  return (
    <div
      className={cn(
        'shrink-0 rounded-md border border-border bg-card/80',
        'select-none',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 px-2 py-1.5">
        <button
          type="button"
          onClick={toggleExpanded}
          className="flex min-w-0 flex-1 items-start gap-1.5 rounded-sm text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={sectionExpanded}
        >
          {sectionExpanded ? (
            <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          ) : (
            <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-foreground">Time · duration</p>
            <p className="text-[10px] text-muted-foreground">
              The menu sets the chart’s time span (local time). Drag on the chart to filter the table
              by time and duration.
            </p>
          </div>
        </button>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Select value={preset} onValueChange={(v) => setPresetPersist(v as TimeframePresetId)}>
            <SelectTrigger
              aria-label="Chart time span"
              className="h-8 w-[min(17.5rem,calc(100vw-8rem))] max-w-full text-[10px] sm:w-72"
            >
              <SelectValue placeholder="Time window" />
            </SelectTrigger>
            <SelectContent position="popper" className="z-[90] max-h-[min(24rem,70vh)]">
              {TIMEFRAME_PRESETS.map((row) => (
                <SelectItem key={row.id} value={row.id} className="text-xs">
                  {row.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {brush ? (
            <span className="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-foreground">
              Filter on
            </span>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-[10px]"
                disabled={!brush}
                onClick={() => onClearBrush()}
              >
                Clear filter
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-[14rem] text-xs">
              Clears the time and duration window so all rows in the current slice show again.
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      {sectionExpanded ? (
        jobs.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
            No jobs in the current slice — nothing to plot.
          </p>
        ) : (
          <div className="h-[200px] w-full min-w-0 cursor-crosshair">
            <ParentSize debounceTime={32}>
              {({ width, height }) => (
                <QueueJobsTimeframeHeatmapInner
                  key={`${resetKey}-${preset}`}
                  width={width}
                  height={height}
                  jobs={jobs}
                  jobStatus={jobStatus}
                  nowMs={nowMs}
                  timeRange={timeRange}
                  onBrushDomain={onBrushChange}
                />
              )}
            </ParentSize>
          </div>
        )
      ) : null}
    </div>
  );
}
