import type { JobStatus, JobsQueryStatus } from '@/lib/api';

/** Neutral tab chrome; status color comes from the dot (`JOB_STATE_STYLES.dot`). */
export const JOB_STATE_TAB_TRIGGER_CLASSES =
  'group border-transparent bg-muted/25 text-muted-foreground hover:bg-muted/50 data-[state=active]:border-border data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm';

export const JOB_STATE_STYLES: Record<
  JobStatus,
  {
    dot: string;
    /** Chips outside neutral tabs (queue summary row, modal status). */
    countBadge: string;
    /** Overview bar chart — `hsl(var(--chart-*))` in `index.css`. */
    barFill: string;
    cardBorder: string;
  }
> = {
  waiting: {
    dot: 'bg-slate-400 dark:bg-slate-500',
    countBadge: 'bg-muted text-foreground',
    barFill: 'hsl(var(--chart-1))',
    cardBorder: 'border-l-foreground/25',
  },
  active: {
    dot: 'bg-white ring-1 ring-border dark:bg-white dark:ring-border',
    countBadge: 'border border-border bg-background text-foreground',
    barFill: 'hsl(var(--foreground))',
    cardBorder: 'border-l-foreground/40',
  },
  delayed: {
    dot: 'bg-amber-500 dark:bg-amber-400',
    countBadge: 'bg-muted text-foreground',
    barFill: 'hsl(var(--chart-3))',
    cardBorder: 'border-l-foreground/32',
  },
  completed: {
    dot: 'bg-emerald-600 dark:bg-emerald-500',
    countBadge:
      'border border-emerald-500/35 bg-emerald-500/12 text-emerald-800 dark:text-emerald-300',
    barFill: 'hsl(142 71% 40%)',
    cardBorder: 'border-l-emerald-500/45',
  },
  failed: {
    dot: 'bg-red-600 dark:bg-red-500',
    countBadge: 'border border-red-500/40 bg-red-500/12 text-red-800 dark:text-red-300',
    barFill: 'hsl(0 72% 48%)',
    cardBorder: 'border-l-red-500/50',
  },
  paused: {
    dot: 'bg-violet-500 dark:bg-violet-400',
    countBadge: 'bg-muted text-muted-foreground',
    barFill: 'hsl(var(--chart-6))',
    cardBorder: 'border-l-muted-foreground/40',
  },
};

export const OVERVIEW_STATE_ORDER: {
  status: JobStatus;
  title: string;
}[] = [
  { status: 'waiting', title: 'Waiting' },
  { status: 'active', title: 'Active' },
  { status: 'delayed', title: 'Delayed' },
  { status: 'completed', title: 'Completed' },
  { status: 'failed', title: 'Failed' },
  { status: 'paused', title: 'Paused' },
];

/** Queue jobs tabs: merged “All” first, then per-state tabs. */
export const QUEUE_JOBS_TAB_ORDER: {
  status: JobsQueryStatus;
  title: string;
}[] = [
  { status: 'all', title: 'All' },
  ...OVERVIEW_STATE_ORDER,
];

/** SVG / heatmap fills aligned with {@link JOB_STATE_STYLES} dots. */
export const JOB_STATE_HEATMAP_FILL: Record<JobStatus, string> = {
  waiting: 'hsl(215 16% 52%)',
  active: 'hsl(0 0% 92%)',
  delayed: 'hsl(38 92% 50%)',
  completed: 'hsl(142 71% 40%)',
  failed: 'hsl(0 72% 52%)',
  paused: 'hsl(263 70% 55%)',
};
