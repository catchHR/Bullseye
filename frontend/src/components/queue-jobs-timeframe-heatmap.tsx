import { Brush } from '@visx/brush';
import type { Bounds } from '@visx/brush/lib/types';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { GridColumns, GridRows } from '@visx/grid';
import { Group } from '@visx/group';
import { ParentSize } from '@visx/responsive';
import { scaleLinear, scaleTime } from '@visx/scale';
import { Button } from '@/components/ui/button';
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
import { useCallback, useEffect, useMemo, useState } from 'react';

const TIMEFRAME_EXPANDED_KEY = 'bullseye-queue-jobs-timeframe-expanded';

function readTimeframeExpanded(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  return window.localStorage.getItem(TIMEFRAME_EXPANDED_KEY) !== '0';
}

const BLOCK = 5;
const MARGIN = { top: 8, left: 56, right: 10, bottom: 36 };

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
  onBrushDomain: (brush: TimeframeBrush | null) => void;
};

function QueueJobsTimeframeHeatmapInner({
  width,
  height,
  jobs,
  jobStatus,
  nowMs,
  onBrushDomain,
}: HeatmapInnerProps) {
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
      list.push({ job, ...c });
    }
    return list;
  }, [jobs, jobStatus, nowMs]);

  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);

  const { xScale, yScale, p99, maxD, maxT, minT } = useMemo(() => {
    if (points.length === 0 || innerWidth <= 0 || innerHeight <= 0) {
      const now = nowMs;
      const x = scaleTime({
        domain: [new Date(now - 3600_000), new Date(now)],
        range: [0, Math.max(1, innerWidth)],
      });
      const y = scaleLinear({
        domain: [0, 1],
        range: [Math.max(1, innerHeight), 0],
      });
      return {
        xScale: x,
        yScale: y,
        p99: 0,
        maxD: 0,
        maxT: now,
        minT: now - 3600_000,
      };
    }

    let minTime = points[0].tMs;
    let maxTime = points[0].tMs;
    const durs: number[] = [];
    for (const p of points) {
      minTime = Math.min(minTime, p.tMs);
      maxTime = Math.max(maxTime, p.tMs);
      durs.push(p.durationMs);
    }
    durs.sort((a, b) => a - b);
    const p99v = percentile(durs, 0.99);
    const maxDv = Math.max(1, durs[durs.length - 1] ?? 1, p99v * 1.02);

    if (maxTime - minTime < 60_000) {
      const mid = (minTime + maxTime) / 2;
      minTime = mid - 30_000;
      maxTime = mid + 30_000;
    }

    const x = scaleTime({
      domain: [new Date(minTime), new Date(maxTime)],
      range: [0, innerWidth],
    });
    const y = scaleLinear({
      domain: [0, maxDv],
      range: [innerHeight, 0],
    });

    return {
      xScale: x,
      yScale: y,
      p99: p99v,
      maxD: maxDv,
      maxT: maxTime,
      minT: minTime,
    };
  }, [points, innerWidth, innerHeight, nowMs]);

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
        tickFormat={(v) => {
          const d = v as Date;
          return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        }}
        tickStroke="currentColor"
        tickLabelProps={{
          fill: 'currentColor',
          fontSize: 9,
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
              Drag a rectangle on the chart, release to filter the table by time and duration (
              <a
                href="https://visx.airbnb.tech/"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-muted-foreground/60 underline-offset-2 hover:text-foreground"
                onClick={(event) => event.stopPropagation()}
              >
                visx
              </a>
              ).
              {jobStatus === 'all'
                ? ' Colors match job state (same as the status tags).'
                : null}
            </p>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
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
                  key={resetKey}
                  width={width}
                  height={height}
                  jobs={jobs}
                  jobStatus={jobStatus}
                  nowMs={nowMs}
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
