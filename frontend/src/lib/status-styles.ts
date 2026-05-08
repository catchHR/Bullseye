import type { JobStatus } from '@/lib/api';

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
    dot: 'bg-sky-500 dark:bg-sky-400',
    countBadge: 'bg-muted text-foreground',
    barFill: 'hsl(var(--chart-2))',
    cardBorder: 'border-l-foreground/40',
  },
  delayed: {
    dot: 'bg-amber-500 dark:bg-amber-400',
    countBadge: 'bg-muted text-foreground',
    barFill: 'hsl(var(--chart-3))',
    cardBorder: 'border-l-foreground/32',
  },
  completed: {
    dot: 'bg-primary',
    countBadge: 'bg-muted text-muted-foreground',
    barFill: 'hsl(var(--primary))',
    cardBorder: 'border-l-primary/35',
  },
  failed: {
    dot: 'bg-red-600 dark:bg-red-500',
    countBadge: 'bg-muted text-foreground',
    barFill: 'hsl(var(--chart-5))',
    cardBorder: 'border-l-foreground/50',
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
