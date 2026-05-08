import type { JobRow } from '@/lib/api';
import {
  formatDurationCompact,
  formatTimestampIso,
  formatTimestampPretty,
  formatTimestampTimelineParts,
} from '@/lib/format';
import { cn } from '@/lib/utils';

function durationBetween(
  startMs: number | null | undefined,
  endMs: number | null | undefined,
): number | null {
  if (
    startMs == null ||
    endMs == null ||
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    startMs <= 0 ||
    endMs <= 0 ||
    endMs < startMs
  ) {
    return null;
  }
  return endMs - startMs;
}

/** Equal spacing between the three dots (symmetric gutters). */
const GRID_COLS = 'grid-cols-[4.5rem_minmax(0,1fr)_4.5rem_minmax(0,1fr)_4.5rem] sm:grid-cols-[5.25rem_minmax(0,1fr)_5.25rem_minmax(0,1fr)_5.25rem]';

/** Fixed row heights: duration row and milestone row align across columns. */
const ROW_DOT = 'row-start-1';
const ROW_DURATION = 'row-start-2';
const ROW_MILESTONE = 'row-start-3';

export function JobLifecycleTimeline({ job }: { job: JobRow }) {
  const createdMs = job.timestamp > 0 ? job.timestamp : null;
  const processedMs =
    job.processedOn != null && job.processedOn > 0 ? job.processedOn : null;
  const finishedMs =
    job.finishedOn != null && job.finishedOn > 0 ? job.finishedOn : null;

  const waitMs = durationBetween(createdMs, processedMs);
  const runMs = durationBetween(processedMs, finishedMs);

  const waitLabel =
    waitMs != null
      ? formatDurationCompact(waitMs)
      : processedMs == null
        ? 'Not processed yet'
        : '—';
  const waitTitle =
    waitMs != null
      ? `${formatDurationCompact(waitMs)} from created to processed`
      : undefined;
  const waitVariant = waitMs != null ? 'complete' : 'pending';

  const runLabel =
    runMs != null
      ? formatDurationCompact(runMs)
      : processedMs != null && finishedMs == null
        ? 'Still running'
        : '—';
  const runTitle =
    runMs != null
      ? `${formatDurationCompact(runMs)} from processed to finished`
      : undefined;
  const runVariant =
    runMs != null ? 'complete' : processedMs != null && finishedMs == null ? 'active' : 'pending';

  return (
    <div className="overflow-x-auto pb-2">
      <div className={cn('grid w-full min-w-[260px] gap-y-1 sm:min-w-full', GRID_COLS)}>
        {/* Row 1: dots + horizontal connectors */}
        <div
          className={cn(
            'col-start-1 flex flex-col items-center justify-center',
            ROW_DOT,
          )}
        >
          <TimelineDot state="done" />
        </div>
        <LineConnector gridColumnClass="col-start-2" />
        <div
          className={cn(
            'col-start-3 flex flex-col items-center justify-center',
            ROW_DOT,
          )}
        >
          <TimelineDot state={processedMs != null ? 'done' : 'pending'} />
        </div>
        <LineConnector gridColumnClass="col-start-4" />
        <div
          className={cn(
            'col-start-5 flex flex-col items-center justify-center',
            ROW_DOT,
          )}
        >
          <TimelineDot state={finishedMs != null ? 'done' : 'pending'} />
        </div>

        {/* Row 2: durations only (aligned baseline) */}
        <div className={cn('col-start-1', ROW_DURATION)} />
        <div
          className={cn(
            'col-start-2 flex min-h-[1.125rem] items-start justify-center px-1 pt-0.5',
            ROW_DURATION,
          )}
        >
          <DurationText label={waitLabel} title={waitTitle} variant={waitVariant} />
        </div>
        <div className={cn('col-start-3', ROW_DURATION)} />
        <div
          className={cn(
            'col-start-4 flex min-h-[1.125rem] items-start justify-center px-1 pt-0.5',
            ROW_DURATION,
          )}
        >
          <DurationText label={runLabel} title={runTitle} variant={runVariant} />
        </div>
        <div className={cn('col-start-5', ROW_DURATION)} />

        {/* Row 3: milestone labels + timestamps */}
        <div
          className={cn(
            'col-start-1 -mt-[20px] flex flex-col items-center gap-0.5',
            ROW_MILESTONE,
          )}
        >
          <MilestoneText label="Created" timestampMs={createdMs} state="done" />
        </div>
        <div className={cn('col-start-2', ROW_MILESTONE)} />
        <div
          className={cn(
            'col-start-3 -mt-[20px] flex flex-col items-center gap-0.5',
            ROW_MILESTONE,
          )}
        >
          <MilestoneText
            label="Processed"
            timestampMs={processedMs}
            state={processedMs != null ? 'done' : 'pending'}
          />
        </div>
        <div className={cn('col-start-4', ROW_MILESTONE)} />
        <div
          className={cn(
            'col-start-5 -mt-[20px] flex flex-col items-center gap-0.5',
            ROW_MILESTONE,
          )}
        >
          <MilestoneText
            label="Finished"
            timestampMs={finishedMs}
            state={finishedMs != null ? 'done' : 'pending'}
          />
        </div>
      </div>
    </div>
  );
}

function LineConnector({ gridColumnClass }: { gridColumnClass: 'col-start-2' | 'col-start-4' }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center self-stretch',
        ROW_DOT,
        gridColumnClass,
      )}
    >
      <div className="flex w-full items-center px-0.5">
        <div className="h-px w-full min-w-[1rem] bg-border" />
      </div>
    </div>
  );
}

function TimelineDot({ state }: { state: 'done' | 'pending' }) {
  const isPending = state === 'pending';
  return (
    <span
      className={cn(
        'h-2 w-2 shrink-0 rounded-full ring-2 ring-card ring-offset-0',
        isPending
          ? 'border border-muted-foreground/45 bg-card'
          : 'border border-foreground/25 bg-foreground/85',
      )}
      aria-hidden
    />
  );
}

function DurationText({
  label,
  title,
  variant,
}: {
  label: string;
  title?: string;
  variant: 'complete' | 'pending' | 'active';
}) {
  const textClass =
    variant === 'pending' ? 'text-muted-foreground/65' : 'text-muted-foreground';

  return (
    <span
      className={cn(
        'max-w-full text-center font-mono text-[10px] font-normal tabular-nums leading-none tracking-tight',
        textClass,
        variant === 'active' && 'italic',
      )}
      title={title}
    >
      {label}
    </span>
  );
}

function MilestoneText({
  label,
  timestampMs,
  state,
}: {
  label: string;
  timestampMs: number | null;
  state: 'done' | 'pending';
}) {
  const isPending = state === 'pending';
  const parts = formatTimestampTimelineParts(timestampMs);
  const titleIso = formatTimestampIso(timestampMs);
  const fallbackPretty = formatTimestampPretty(timestampMs);

  return (
    <>
      <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {parts ? (
        <span
          className={cn(
            'flex max-w-full cursor-default flex-col items-center gap-px px-px text-center font-mono leading-tight',
            isPending ? 'text-muted-foreground/80' : 'text-foreground/90',
          )}
          title={titleIso || undefined}
        >
          <span className="text-[11px] font-medium tabular-nums">{parts.time}</span>
          <span
            className={cn(
              'text-[9px] tabular-nums',
              isPending ? 'text-muted-foreground/60' : 'text-muted-foreground',
            )}
          >
            {parts.date}
          </span>
        </span>
      ) : (
        <span
          className="cursor-default text-center font-mono text-[10px] text-muted-foreground/70"
          title={titleIso || undefined}
        >
          {fallbackPretty}
        </span>
      )}
    </>
  );
}
