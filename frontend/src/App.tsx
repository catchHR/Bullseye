import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
const AlertsPanelLazy = lazy(() =>
  import('@/components/alerts-panel').then((module) => ({
    default: module.AlertsPanel,
  })),
);
// Legacy: centered dialog — replaced by `JobDetailDrawer` (right sheet + row highlight).
// const JobDetailModalLazy = lazy(() =>
//   import('@/components/job-detail-modal').then((module) => ({
//     default: module.JobDetailModal,
//   })),
// );
const JobDetailDrawerLazy = lazy(() =>
  import('@/components/job-detail-drawer').then((module) => ({
    default: module.JobDetailDrawer,
  })),
);
const BullseyeCommandMenuLazy = lazy(() =>
  import('@/components/bullseye-command-menu').then((module) => ({
    default: module.BullseyeCommandMenu,
  })),
);
import { JobLogStatusMultiSelect } from '@/components/multi-select';
import { QueueJobsTable } from '@/components/queue-jobs-table';
import { SidebarAccountMenu } from '@/components/sidebar-account-menu';
import { QueueJobFilters } from '@/components/queue-job-filters';
import { QueueStatusSegmentBar } from '@/components/queue-status-segment-bar';
import { useMdUp, useQueueListSidebarResize } from '@/hooks/use-queue-list-sidebar-resize';
import {
  fetchJobLog,
  fetchJobRuntimeStats,
  fetchJobs,
  fetchQueues,
  fetchRepeatableJobs,
  fetchRedisMetrics,
  fetchUiConfig,
  promoteJob,
  ALL_QUEUES_SENTINEL,
  removeQueueJob,
  retryQueueJob,
  type BullseyeOperatorUi,
  type CrossQueueJobLogResponse,
  type JobRow,
  type JobRuntimeStats,
  type JobsQueryStatus,
  type JobStatus,
  type QueueSummary,
  type RedisMetrics,
  type RepeatableJob,
} from '@/lib/api';
import { stripEnqueueMetaFromOpts } from '@/lib/bull-job-opts';
import { filterJobs } from '@/lib/job-filter';
import {
  formatCronNaturalLanguage,
  formatBytesBinary,
  formatDurationCompact,
  formatEveryMs,
  formatEveryNaturalLanguage,
  formatNextRun,
  formatProgressValue,
  formatTimestampIso,
  formatTimestampPretty,
} from '@/lib/format';
import {
  encodeShareableUiState,
  jobLogStatusesFromShareable,
  pushUrlWithUiState,
  readUiParamFromLocation,
  readUiQueryParamRaw,
  type NavView,
  type OverviewDashboardTab,
} from '@/lib/url-state';
import {
  JOB_STATE_STYLES,
  JOB_STATE_TAB_TRIGGER_CLASSES,
  OVERVIEW_STATE_ORDER,
  QUEUE_JOBS_TAB_ORDER,
} from '@/lib/status-styles';
import { cn } from '@/lib/utils';
import {
  Activity,
  Bell,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  LayoutDashboard,
  ListTree,
  Menu,
  Pause,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  ScrollText,
  Search,
  Timer,
  X,
} from 'lucide-react';
import {
  DASHBOARD_TIMESPAN_OPTIONS,
  dashboardTimespanDurationMs,
  writeStoredDashboardTimespanId,
  type DashboardTimespanId,
} from '@/lib/dashboard-timespan';
import { toast } from '@/lib/bullseye-toast';
import { QueueActionsMenu } from '@/components/queue-actions-menu';
import { QueueJobWriteModal } from '@/components/queue-job-write-modal';

/**
 * Dashboard time-range `Select` in the header. Off: metrics use full sample / session (`all`).
 * Re-enable with `DASHBOARD_TIMESPAN_OPTIONS` + `readStoredDashboardTimespanId` from `@/lib/dashboard-timespan`.
 */
const SHOW_DASHBOARD_TIMESPAN_SELECTOR = false;

/** Toasts when polling detects new or removed jobs for the current status tab. */
function reportJobListPollEvents(
  jobStatus: JobsQueryStatus,
  previousJobsById: Map<string, { name: string }>,
  nextJobs: JobRow[],
  liveToastsEnabled: boolean,
): void {
  if (!liveToastsEnabled) {
    return;
  }
  if (jobStatus === 'all') {
    return;
  }
  if (previousJobsById.size === 0) {
    return;
  }
  const previousIds = new Set(previousJobsById.keys());
  const nextById = new Map(nextJobs.map((jobRow) => [jobRow.id, jobRow]));

  if (jobStatus === 'completed') {
    const newlyListed = nextJobs.filter((jobRow) => !previousIds.has(jobRow.id));
    if (newlyListed.length === 1) {
      const jobRow = newlyListed[0];
      toast.success(`Job completed: ${jobRow.name} (#${jobRow.id})`);
    } else if (newlyListed.length > 1) {
      toast.success(`${newlyListed.length} new jobs appeared in Completed.`);
    }
    return;
  }

  if (jobStatus === 'failed') {
    const newlyListed = nextJobs.filter((jobRow) => !previousIds.has(jobRow.id));
    if (newlyListed.length === 1) {
      const jobRow = newlyListed[0];
      toast.error(`Job failed: ${jobRow.name} (#${jobRow.id})`);
    } else if (newlyListed.length > 1) {
      toast.error(`${newlyListed.length} new jobs appeared in Failed.`);
    }
    return;
  }

  if (jobStatus === 'active') {
    const leftActiveIds = [...previousIds].filter((jobId) => !nextById.has(jobId));
    if (leftActiveIds.length === 0) {
      return;
    }
    const maxIndividualToasts = 3;
    let individualToastCount = 0;
    for (const jobId of leftActiveIds) {
      if (individualToastCount >= maxIndividualToasts) {
        break;
      }
      const meta = previousJobsById.get(jobId);
      toast.message(`No longer active: ${meta?.name ?? jobId} (#${jobId})`, {
        description: 'Completed, failed, or moved to another state.',
      });
      individualToastCount++;
    }
    const remainingCount = leftActiveIds.length - individualToastCount;
    if (remainingCount > 0) {
      toast.message(`${remainingCount} more job(s) left Active.`);
    }
    return;
  }

  if (jobStatus === 'waiting') {
    const noLongerWaitingCount = [...previousIds].filter(
      (jobId) => !nextById.has(jobId),
    ).length;
    if (noLongerWaitingCount === 1) {
      toast.message('A job left the waiting list (picked up or delayed).');
    } else if (noLongerWaitingCount > 1) {
      toast.message(`${noLongerWaitingCount} jobs left the waiting list.`);
    }
  }
}

const LOG_PAGE_SIZE = 50;

const BAR_SHORT_LABEL: Record<JobStatus, string> = {
  waiting: 'wait',
  active: 'run',
  delayed: 'due',
  completed: 'ok',
  failed: 'fail',
  paused: 'pause',
};

/** Recharts tooltips do not inherit theme text colors; set explicit foreground for dark mode. */
const RECHARTS_TOOLTIP_PROPS = {
  contentStyle: {
    backgroundColor: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 6,
    fontSize: 11,
    color: 'hsl(var(--card-foreground))',
  },
  labelStyle: {
    color: 'hsl(var(--foreground))',
    fontWeight: 600,
    marginBottom: 4,
  },
  itemStyle: {
    color: 'hsl(var(--card-foreground))',
  },
} as const;

/** Axis labels: dedicated `--chart-axis` token reads well on light + dark chart backgrounds. */
const CHART_AXIS_TICK = {
  fontSize: 10,
  fill: 'hsl(var(--chart-axis))',
} as const;

const CHART_AXIS_TICK_SM = {
  fontSize: 9,
  fill: 'hsl(var(--chart-axis))',
} as const;

/** Pie segments: monochrome ramp (`--chart-1` … `--chart-8` in `index.css`). */
const CHART_SLICE_FILLS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--chart-6))',
  'hsl(var(--chart-7))',
  'hsl(var(--chart-8))',
];

function countForStatus(summary: QueueSummary | undefined, status: JobStatus): number {
  if (!summary) {
    return 0;
  }
  return summary.counts[status];
}

function sumCountsAllStates(summary: QueueSummary | undefined): number {
  if (!summary) {
    return 0;
  }
  return OVERVIEW_STATE_ORDER.reduce(
    (acc, { status }) => acc + summary.counts[status],
    0,
  );
}

function statusTitle(status: JobStatus): string {
  return OVERVIEW_STATE_ORDER.find((entry) => entry.status === status)?.title ?? status;
}

/** 1-based current page, inclusive range for numbered pagination controls. */
function jobLogPaginationPages(
  currentPage: number,
  totalPages: number,
): Array<number | 'gap'> {
  if (totalPages <= 0) {
    return [];
  }
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const pageSet = new Set<number>();
  pageSet.add(1);
  pageSet.add(totalPages);
  for (let delta = -2; delta <= 2; delta++) {
    const page = currentPage + delta;
    if (page >= 1 && page <= totalPages) {
      pageSet.add(page);
    }
  }
  const sorted = [...pageSet].sort((left, right) => left - right);
  const result: Array<number | 'gap'> = [];
  let previousPage = 0;
  for (const page of sorted) {
    if (previousPage > 0 && page - previousPage > 1) {
      result.push('gap');
    }
    result.push(page);
    previousPage = page;
  }
  return result;
}

function sumTotals(queues: QueueSummary[]) {
  const totals = {
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
    paused: 0,
  };
  for (const queue of queues) {
    totals.waiting += queue.counts.waiting;
    totals.active += queue.counts.active;
    totals.completed += queue.counts.completed;
    totals.failed += queue.counts.failed;
    totals.delayed += queue.counts.delayed;
    totals.paused += queue.counts.paused;
  }
  return totals;
}

function sumTotalsAllStates(t: ReturnType<typeof sumTotals>): number {
  return OVERVIEW_STATE_ORDER.reduce((acc, { status }) => acc + t[status], 0);
}

const REDIS_TOOLTIP_USED_MEMORY =
  'Memory Redis has allocated for data and overhead (RSS-related fields are separate). If you set maxmemory, compare to that limit: sustained growth toward 100% risks evictions or write errors depending on policy. Sudden jumps often correlate with large queue backlogs or big payloads.';

const REDIS_TOOLTIP_PEAK_MEMORY =
  'High-water mark of used memory since the server started. If peak is far above current use, you may have had a spike (batch jobs, large keys) or fragmentation. Together with fragmentation ratio, it helps decide if a restart or memory policy change is worth planning.';

const REDIS_TOOLTIP_CONNECTED_CLIENTS =
  'Number of client connections (apps, workers, Bullseye, replicas). A steady count is normal; a fast climb can mean connection leaks or many short-lived clients. “Blocked” clients are waiting on blocking commands (e.g. BLPOP-style); a high blocked count can mean workers stalling on Redis.';

const REDIS_TOOLTIP_OPS_PER_SEC =
  'Approximate commands processed per second (instantaneous). Useful as a rough load gauge: higher with more enqueue/consume activity. Compare across time rather than obsessing over absolute values—sudden drops with app slowness can point to Redis or network contention.';

const REDIS_TOOLTIP_HIT_RATE =
  'Share of keyspace reads served from Redis memory vs. needing a disk load (for datasets larger than RAM this matters more). Low hit rate with high misses can mean cold cache, insufficient memory, or access patterns that churn keys. Pair with memory and latency when tuning.';

const REDIS_TOOLTIP_DB_KEYS =
  'Approximate number of keys in the selected logical database (from DBSIZE). Bull/BullMQ uses many keys per queue; a large count is expected at scale. Watch growth rate: runaway keys can mean stuck jobs, missing cleanup, or duplicate deployments writing to the same DB.';

const REDIS_TOOLTIP_UPTIME =
  'Time since the Redis process started. Short uptime after incidents may explain gaps in charts. Very long uptime is fine; memory fragmentation can creep up over time—compare with peak memory and fragmentation ratio.';

const REDIS_TOOLTIP_ROLE =
  'Instance role (e.g. master, replica, sentinel-managed). For Bull queues you usually want workers and the API talking to the same writable primary. Read replicas are fine for observability but not for enqueue/consume unless you know what you are doing.';

function RedisMetricCard({
  label,
  value,
  hint,
  info,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Tooltip: what the metric means + brief interpretation */
  info: string;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/15 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`About ${label}`}
            >
              <Info className="h-3.5 w-3.5 opacity-80" strokeWidth={2} aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[20rem] text-left text-xs leading-snug">
            {info}
          </TooltipContent>
        </Tooltip>
      </div>
      <p className="mt-1 font-mono text-sm font-semibold tabular-nums">{value}</p>
      {hint ? (
        <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

const NAV_ITEMS: { id: NavView; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'queues', label: 'Queues', icon: ListTree },
  { id: 'schedules', label: 'Schedules', icon: CalendarClock },
  { id: 'log', label: 'Job log', icon: ScrollText },
  { id: 'alerts', label: 'Alerts', icon: Bell },
];

const NAV_ITEM_TOOLTIP: Record<NavView, string> = {
  overview: 'Live counts, queue mix, and session charts.',
  queues: 'Pick a queue, filter jobs, and open job details.',
  schedules: 'Cron and interval repeatable jobs (Bull repeat).',
  log: 'Cross-queue sample of completed and failed job history.',
  alerts: 'Notify when queue depth crosses a threshold.',
};

const POLLING_INTERVAL_STORAGE_KEY = 'bullseye-polling-interval-ms';

/** Bull `getJobs` range is inclusive; 500 rows per request in the queue jobs table. */
const QUEUE_JOBS_PAGE_SIZE = 500;

const POLLING_INTERVAL_OPTIONS: { valueMs: number; label: string }[] = [
  { valueMs: 0, label: 'Off' },
  { valueMs: 5000, label: '5s' },
  { valueMs: 10000, label: '10s' },
  { valueMs: 20000, label: '20s' },
  { valueMs: 30000, label: '30s' },
  { valueMs: 60000, label: '60s' },
];

const POLLING_INTERVAL_LEGACY: Record<number, number> = {
  3000: 5000,
  8000: 10000,
  15000: 20000,
};

function readStoredPollingIntervalMs(): number {
  if (typeof window === 'undefined') {
    return 10000;
  }
  const allowed = new Set(POLLING_INTERVAL_OPTIONS.map((option) => option.valueMs));
  const raw = window.localStorage.getItem(POLLING_INTERVAL_STORAGE_KEY);
  const parsed = raw != null ? Number.parseInt(raw, 10) : Number.NaN;
  if (allowed.has(parsed)) {
    return parsed;
  }
  const mapped = POLLING_INTERVAL_LEGACY[parsed];
  if (mapped != null && allowed.has(mapped)) {
    return mapped;
  }
  return 10000;
}

const LIVE_JOB_TOASTS_STORAGE_KEY = 'bullseye-live-job-toasts';

function readStoredLiveJobToastsEnabled(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  const raw = window.localStorage.getItem(LIVE_JOB_TOASTS_STORAGE_KEY);
  if (raw === '0') {
    return false;
  }
  return true;
}

const bullseyeLogoUrl = `${import.meta.env.BASE_URL}bullseye_logo.svg`;

const DEFAULT_OPERATOR_UI: BullseyeOperatorUi = {
  displayName: 'Bullseye',
  email: 'operator@local',
  avatarUrl: null,
};

function AppSidebar({
  activeNav,
  onNavigate,
  onCloseMobile,
  navCompact,
  onOpenCommandPalette,
  operatorUi,
}: {
  activeNav: NavView;
  onNavigate: (view: NavView) => void;
  onCloseMobile?: () => void;
  navCompact?: boolean;
  onOpenCommandPalette: () => void;
  operatorUi: BullseyeOperatorUi;
}) {
  const isMobileDrawer = onCloseMobile != null;
  const isMacPlatform = useMemo(
    () => typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent),
    [],
  );
  const commandPaletteKeyboardDescription = isMacPlatform ? '⌘K' : 'Ctrl+K';

  return (
    <>
      <div
        className={cn(
          'flex shrink-0 items-center border-b border-border',
          navCompact && !isMobileDrawer
            ? 'flex-col gap-1.5 px-1 py-2'
            : 'h-12 flex-row px-2 sm:px-2.5',
          isMobileDrawer && 'justify-between',
        )}
      >
        <div
          className={cn(
            'flex min-w-0 items-center gap-2',
            navCompact && !isMobileDrawer ? 'flex-col justify-center px-0' : 'flex-1',
          )}
        >
          <img
            src={bullseyeLogoUrl}
            alt=""
            decoding="async"
            className="h-3 w-auto max-h-3 max-w-[min(100%,11rem)] shrink-0 object-contain object-left transition-[filter] duration-200 dark:invert"
          />
          {!navCompact || isMobileDrawer ? (
            <span className="font-logo truncate text-lg font-semibold tracking-tight text-foreground">
              bullseye
            </span>
          ) : null}
        </div>
        {isMobileDrawer ? (
          <div className="flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 shrink-0 sm:h-9 sm:w-9"
                  onClick={onCloseMobile}
                  aria-label="Close menu"
                >
                  <X className="h-5 w-5" strokeWidth={1.75} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Close navigation</TooltipContent>
            </Tooltip>
          </div>
        ) : null}
      </div>
      {!navCompact || isMobileDrawer ? (
        <div className="shrink-0 border-b border-border px-2 pb-2 pt-2 sm:px-2.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="h-9 w-full items-center justify-start gap-2 px-2.5 font-normal text-muted-foreground hover:text-foreground"
                onClick={() => onOpenCommandPalette()}
                aria-label={`Open search (${commandPaletteKeyboardDescription})`}
              >
                <Search className="h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={2} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-left text-xs">Queues & Jobs…</span>
                <KbdGroup className="pointer-events-none hidden shrink-0 sm:inline-flex">
                  {isMacPlatform ? (
                    <>
                      <Kbd aria-hidden>⌘</Kbd>
                      <Kbd aria-hidden>K</Kbd>
                    </>
                  ) : (
                    <>
                      <Kbd aria-hidden>Ctrl</Kbd>
                      <span className="text-xs text-muted-foreground/70" aria-hidden>
                        +
                      </span>
                      <Kbd aria-hidden>K</Kbd>
                    </>
                  )}
                </KbdGroup>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[13rem] text-left leading-snug">
              Jump to a queue or set a job-name filter. Shortcut: {commandPaletteKeyboardDescription}
            </TooltipContent>
          </Tooltip>
        </div>
      ) : (
        <div className="flex shrink-0 justify-center border-b border-border px-1 pb-2 pt-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0 items-center justify-center"
                onClick={() => onOpenCommandPalette()}
                aria-label={`Open search (${commandPaletteKeyboardDescription})`}
              >
                <Search className="h-4 w-4" strokeWidth={2} aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              Quick search ({commandPaletteKeyboardDescription})
            </TooltipContent>
          </Tooltip>
        </div>
      )}
      <nav
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2 sm:px-2.5"
        aria-label="Main navigation"
      >
        {NAV_ITEMS.map((item) => {
          const isCompactRail = navCompact && !isMobileDrawer;
          const navButton = (
            <Button
              type="button"
              variant="ghost"
              onClick={() => onNavigate(item.id)}
              aria-current={activeNav === item.id ? 'page' : undefined}
              className={cn(
                'h-auto min-h-11 w-full justify-start gap-2 rounded-md py-2 font-normal sm:min-h-9',
                isCompactRail ? 'justify-center px-2' : 'px-2',
                activeNav === item.id
                  ? 'bg-muted font-medium text-foreground hover:bg-muted'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              <item.icon className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.75} />
              <span className={cn(isCompactRail && 'sr-only')}>{item.label}</span>
            </Button>
          );
          if (!isCompactRail) {
            return (
              <Fragment key={item.id}>
                {navButton}
              </Fragment>
            );
          }
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>{navButton}</TooltipTrigger>
              <TooltipContent side="right" className="max-w-[14rem] text-left leading-snug">
                <p className="font-medium">{item.label}</p>
                <p className="mt-1 text-muted-foreground">{NAV_ITEM_TOOLTIP[item.id]}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
      <div
        className={cn(
          'shrink-0 border-t border-border pb-[max(0.5rem,env(safe-area-inset-bottom))]',
          navCompact && !isMobileDrawer ? 'p-1.5' : 'px-2 py-2 sm:px-2.5',
        )}
      >
        <SidebarAccountMenu
          navCompact={Boolean(navCompact && !isMobileDrawer)}
          isMobileDrawer={isMobileDrawer}
          operatorUi={operatorUi}
        />
      </div>
    </>
  );
}

export default function App() {
  const urlSnap = useMemo(() => readUiParamFromLocation(), []);

  const [nav, setNav] = useState<NavView>(() => urlSnap?.nav ?? 'overview');
  const [queues, setQueues] = useState<QueueSummary[]>([]);
  const [repeatableJobs, setRepeatableJobs] = useState<RepeatableJob[]>([]);
  const [redisMetrics, setRedisMetrics] = useState<RedisMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedQueue, setSelectedQueue] = useState<string | null>(() => urlSnap?.queue ?? null);
  const [jobStatus, setJobStatus] = useState<JobsQueryStatus>(() => urlSnap?.jobStatus ?? 'waiting');
  const [jobWriteQueueName, setJobWriteQueueName] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  /** Inclusive start index for `fetchJobs` (next chunk = +QUEUE_JOBS_PAGE_SIZE). */
  const [jobsOffset, setJobsOffset] = useState(0);
  const [activeSeries, setActiveSeries] = useState<{ t: number; active: number }[]>([]);
  const [jobSearch, setJobSearch] = useState(() => urlSnap?.jobSearch ?? '');
  const [jobSearchForUrl, setJobSearchForUrl] = useState(() => urlSnap?.jobSearch ?? '');
  const [selectedJobNames, setSelectedJobNames] = useState<string[]>(() => urlSnap?.jobNames ?? []);
  const [dataPropertySelections, setDataPropertySelections] = useState<Record<string, string[]>>(
    () => urlSnap?.payload ?? {},
  );
  const [jobDetailContext, setJobDetailContext] = useState<{
    job: JobRow;
    queueName: string;
    modalJobStatus?: JobStatus;
  } | null>(null);

  const [jobsManualRefreshToken, setJobsManualRefreshToken] = useState(0);
  const [jobWriteOpen, setJobWriteOpen] = useState(false);
  const [jobWriteMode, setJobWriteMode] = useState<'create' | 'duplicate'>('create');
  const [jobWriteSourceId, setJobWriteSourceId] = useState<string | undefined>(undefined);
  const [jobWriteSeed, setJobWriteSeed] = useState<{
    name: string;
    data: unknown;
    opts: Record<string, unknown>;
  } | null>(null);

  const [overviewDashboardTab, setOverviewDashboardTab] = useState<OverviewDashboardTab>(
    () => urlSnap?.overviewTab ?? 'workload',
  );
  const [runtimeStats, setRuntimeStats] = useState<JobRuntimeStats | null>(null);
  const [runtimeStatsLoading, setRuntimeStatsLoading] = useState(false);

  const [jobLogOffset, setJobLogOffset] = useState(() => urlSnap?.jobLog?.offset ?? 0);
  const [jobLogStatuses, setJobLogStatuses] = useState<JobStatus[]>(() =>
    jobLogStatusesFromShareable(urlSnap?.jobLog),
  );
  const [jobLogData, setJobLogData] = useState<CrossQueueJobLogResponse | null>(null);
  const [jobLogLoading, setJobLogLoading] = useState(false);

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const globalWindow = globalThis as typeof globalThis & Window;
    if (typeof globalWindow.requestIdleCallback !== 'function') {
      const timeoutId = globalWindow.setTimeout(() => {
        void import('@/components/bullseye-command-menu');
        void import('@/components/job-detail-drawer');
      }, 2000);
      return () => globalWindow.clearTimeout(timeoutId);
    }
    let cancelled = false;
    const prefetchModals = () => {
      if (!cancelled) {
        void import('@/components/bullseye-command-menu');
        void import('@/components/job-detail-drawer');
      }
    };
    const idleId = globalWindow.requestIdleCallback(prefetchModals);
    return () => {
      cancelled = true;
      globalWindow.cancelIdleCallback(idleId);
    };
  }, []);
  const [pollIntervalMs, setPollIntervalMs] = useState<number>(() => readStoredPollingIntervalMs());
  const [liveJobToastsEnabled, setLiveJobToastsEnabled] = useState<boolean>(() =>
    readStoredLiveJobToastsEnabled(),
  );
  const [performanceStatsQueue, setPerformanceStatsQueue] = useState<string>('');
  const [dashboardTimespanId, setDashboardTimespanId] = useState<DashboardTimespanId>('all');
  /** Below `md`: full-screen job panel after choosing a queue; list and jobs are never stacked. */
  const [mobileQueueJobsOpen, setMobileQueueJobsOpen] = useState(false);
  const [operatorUi, setOperatorUi] = useState<BullseyeOperatorUi>(() => ({ ...DEFAULT_OPERATOR_UI }));

  const {
    widthPx: queueListWidthPx,
    isResizing: queueListResizeActive,
    handleResizePointerDown: queueListResizePointerDown,
  } = useQueueListSidebarResize();
  const isMdUp = useMdUp();

  const suppressUrlSyncAfterBrowserHistoryRef = useRef(false);
  const suppressFilterResetAfterBrowserHistoryRef = useRef(false);

  const handlePollIntervalMsChange = useCallback((nextIntervalMs: number) => {
    const allowedValues = new Set(
      POLLING_INTERVAL_OPTIONS.map((option) => option.valueMs),
    );
    if (!allowedValues.has(nextIntervalMs)) {
      return;
    }
    setPollIntervalMs(nextIntervalMs);
    window.localStorage.setItem(POLLING_INTERVAL_STORAGE_KEY, String(nextIntervalMs));
  }, []);

  const handleLiveJobToastsChange = useCallback((nextEnabled: boolean) => {
    setLiveJobToastsEnabled(nextEnabled);
    window.localStorage.setItem(LIVE_JOB_TOASTS_STORAGE_KEY, nextEnabled ? '1' : '0');
  }, []);

  const handleDashboardTimespanChange = useCallback((nextTimespanId: DashboardTimespanId) => {
    setDashboardTimespanId(nextTimespanId);
    writeStoredDashboardTimespanId(nextTimespanId);
  }, []);

  const pollIntervalLabel = useMemo(
    () =>
      POLLING_INTERVAL_OPTIONS.find((option) => option.valueMs === pollIntervalMs)?.label ?? '—',
    [pollIntervalMs],
  );

  const jobDetailHighlightKey = useMemo(
    () =>
      jobDetailContext != null
        ? `${jobDetailContext.queueName}:${jobDetailContext.job.id}`
        : null,
    [jobDetailContext],
  );

  useEffect(() => {
    setJobDetailContext(null);
  }, [nav]);

  useEffect(() => {
    if (!jobDetailContext || nav !== 'queues') {
      return;
    }
    if (selectedQueue == null) {
      return;
    }
    if (selectedQueue !== ALL_QUEUES_SENTINEL && jobDetailContext.queueName !== selectedQueue) {
      return;
    }
    const rowId =
      selectedQueue === ALL_QUEUES_SENTINEL
        ? `${jobDetailContext.queueName}:${jobDetailContext.job.id}`
        : jobDetailContext.job.id;
    const rowElement = document.querySelector(
      `[data-bullseye-job-row="${CSS.escape(rowId)}"]`,
    );
    rowElement?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [jobDetailContext, nav, selectedQueue]);

  useEffect(() => {
    if (!jobDetailContext || nav !== 'log') {
      return;
    }
    const logRowKey = `${jobDetailContext.queueName}:${jobDetailContext.job.id}`;
    const logRowElement = document.querySelector(
      `[data-bullseye-log-row="${CSS.escape(logRowKey)}"]`,
    );
    logRowElement?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [jobDetailContext, nav]);

  useEffect(() => {
    const onPopState = () => {
      suppressUrlSyncAfterBrowserHistoryRef.current = true;
      suppressFilterResetAfterBrowserHistoryRef.current = true;
      const snap = readUiParamFromLocation();
      setNav(snap?.nav ?? 'overview');
      setOverviewDashboardTab(snap?.overviewTab ?? 'workload');
      setSelectedQueue(snap?.queue ?? null);
      setJobStatus(snap?.jobStatus ?? 'waiting');
      const searchFromUrl = snap?.jobSearch ?? '';
      setJobSearch(searchFromUrl);
      setJobSearchForUrl(searchFromUrl);
      setSelectedJobNames(snap?.jobNames ?? []);
      setDataPropertySelections(snap?.payload ?? {});
      setJobLogOffset(snap?.jobLog?.offset ?? 0);
      setJobLogStatuses(jobLogStatusesFromShareable(snap?.jobLog));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const timerId = window.setTimeout(() => setJobSearchForUrl(jobSearch), 400);
    return () => window.clearTimeout(timerId);
  }, [jobSearch]);

  useEffect(() => {
    if (suppressUrlSyncAfterBrowserHistoryRef.current) {
      suppressUrlSyncAfterBrowserHistoryRef.current = false;
      return;
    }
    const encoded = encodeShareableUiState({
      nav,
      overviewTab: overviewDashboardTab,
      queue: selectedQueue,
      jobStatus,
      jobSearch: jobSearchForUrl,
      jobNames: selectedJobNames,
      payload: dataPropertySelections,
      jobLogStatuses,
      jobLogOffset,
    });
    const nextUi = encoded ?? '';
    if (readUiQueryParamRaw() === nextUi) {
      return;
    }
    pushUrlWithUiState(encoded);
  }, [
    nav,
    overviewDashboardTab,
    selectedQueue,
    jobStatus,
    jobSearchForUrl,
    selectedJobNames,
    dataPropertySelections,
    jobLogStatuses,
    jobLogOffset,
  ]);

  const handleNavSelect = useCallback((view: NavView) => {
    setNav(view);
    setMobileNavOpen(false);
  }, []);

  /** Dashboard workload tiles → Queues (all queues) + status tab */
  const goToAllQueuesJobView = useCallback((status: JobsQueryStatus) => {
    setJobDetailContext(null);
    setNav('queues');
    setSelectedQueue(ALL_QUEUES_SENTINEL);
    setJobStatus(status);
    setMobileNavOpen(false);
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      setMobileQueueJobsOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileNavOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileNavOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'k' && event.key !== 'K') {
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }
      const targetElement = event.target;
      const insideCommandDialog =
        targetElement instanceof Element &&
        targetElement.closest('[data-bullseye-command-dialog]') != null;
      if (insideCommandDialog) {
        event.preventDefault();
        setCommandPaletteOpen(false);
        return;
      }
      if (targetElement instanceof HTMLElement) {
        if (targetElement.isContentEditable) {
          return;
        }
        const tagName = targetElement.tagName;
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
          return;
        }
      }
      event.preventDefault();
      setCommandPaletteOpen((previousOpen) => !previousOpen);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (nav !== 'queues') {
      setMobileQueueJobsOpen(false);
    }
  }, [nav]);

  const selectQueueForView = useCallback((queueName: string) => {
    setSelectedQueue(queueName);
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      setMobileQueueJobsOpen(true);
    }
  }, []);

  const handleCommandPaletteSelectQueue = useCallback(
    (queueName: string) => {
      setNav('queues');
      selectQueueForView(queueName);
      setMobileNavOpen(false);
    },
    [selectQueueForView],
  );

  const handleCommandPaletteSelectJobNameFilter = useCallback(
    (queueName: string, jobName: string) => {
      setNav('queues');
      selectQueueForView(queueName);
      setSelectedJobNames([jobName]);
      setJobSearch('');
      setJobSearchForUrl('');
      setJobDetailContext(null);
      if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
        setMobileQueueJobsOpen(true);
      }
      setMobileNavOpen(false);
    },
    [selectQueueForView],
  );

  const bumpJobsRefresh = useCallback(() => {
    setJobsManualRefreshToken((previous) => previous + 1);
  }, []);

  const openCreateJobModalForQueue = useCallback(
    (queueName: string) => {
      selectQueueForView(queueName);
      setJobWriteQueueName(queueName);
      setJobWriteMode('create');
      setJobWriteSourceId(undefined);
      setJobWriteSeed({ name: '', data: {}, opts: {} });
      setJobWriteOpen(true);
    },
    [selectQueueForView],
  );

  const openDuplicateJobModal = useCallback(
    (job: JobRow) => {
      const targetQueue =
        job.queueName ??
        (selectedQueue != null && selectedQueue !== ALL_QUEUES_SENTINEL
          ? selectedQueue
          : null);
      if (!targetQueue) {
        toast.error('Could not determine target queue for duplicate.');
        return;
      }
      setJobWriteQueueName(targetQueue);
      setJobWriteMode('duplicate');
      setJobWriteSourceId(job.id);
      setJobWriteSeed({
        name: job.name ?? '',
        data: job.data ?? {},
        opts: stripEnqueueMetaFromOpts(job.opts ?? {}),
      });
      setJobDetailContext(null);
      setJobWriteOpen(true);
    },
    [selectedQueue],
  );

  const handlePromoteJob = useCallback(
    async (queueName: string, jobId: string) => {
      try {
        await promoteJob(queueName, jobId);
        toast.success('Job promoted to waiting.');
        bumpJobsRefresh();
      } catch (errorUnknown) {
        toast.error(
          errorUnknown instanceof Error ? errorUnknown.message : 'Promote failed.',
        );
      }
    },
    [bumpJobsRefresh],
  );

  const loadQueues = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchQueues();
      setQueues(data);
      setSelectedQueue((previous) => {
        if (!previous) {
          return data[0]?.name ?? null;
        }
        if (previous === ALL_QUEUES_SENTINEL) {
          return ALL_QUEUES_SENTINEL;
        }
        if (data.some((queue) => queue.name === previous)) {
          return previous;
        }
        return data[0]?.name ?? null;
      });
    } catch (errorUnknown) {
      setError(
        errorUnknown instanceof Error
          ? errorUnknown.message
          : 'Queues failed to load',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshQueueSummaries = useCallback(async () => {
    try {
      const data = await fetchQueues();
      setQueues(data);
    } catch {
      /* keep existing summaries */
    }
  }, []);

  const loadRepeatable = useCallback(async () => {
    try {
      const data = await fetchRepeatableJobs();
      setRepeatableJobs(data);
    } catch {
      setRepeatableJobs([]);
    }
  }, []);

  const loadRedisMetrics = useCallback(async (fromPoll = false) => {
    try {
      const data = await fetchRedisMetrics();
      setRedisMetrics(data);
      if (!fromPoll) {
        setError(null);
      }
    } catch (errorUnknown) {
      if (!fromPoll) {
        setError(
          errorUnknown instanceof Error
            ? errorUnknown.message
            : 'Redis metrics failed to load',
        );
      }
    }
  }, []);

  const loadRuntimeStats = useCallback(async () => {
    try {
      setRuntimeStatsLoading(true);
      const durationMs = dashboardTimespanDurationMs(dashboardTimespanId);
      const minFinishedOnMs =
        durationMs == null ? undefined : Date.now() - durationMs;
      const data = await fetchJobRuntimeStats(
        120,
        minFinishedOnMs,
        performanceStatsQueue.trim() || undefined,
      );
      setRuntimeStats(data);
    } catch {
      setRuntimeStats(null);
    } finally {
      setRuntimeStatsLoading(false);
    }
  }, [dashboardTimespanId, performanceStatsQueue]);

  const loadJobLog = useCallback(async (fromPoll = false) => {
    try {
      if (!fromPoll) {
        setJobLogLoading(true);
      }
      const data = await fetchJobLog(jobLogOffset, LOG_PAGE_SIZE, jobLogStatuses);
      setJobLogData(data);
    } catch {
      if (!fromPoll) {
        setJobLogData(null);
      }
    } finally {
      if (!fromPoll) {
        setJobLogLoading(false);
      }
    }
  }, [jobLogOffset, jobLogStatuses]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadQueues(), loadRepeatable(), loadRedisMetrics()]);
      if (nav === 'overview' && overviewDashboardTab === 'performance') {
        await loadRuntimeStats();
      }
      if (nav === 'log') {
        await loadJobLog();
      }
      toast.success('Dashboard refreshed.');
    } catch {
      toast.error('Refresh failed.');
    } finally {
      setLoading(false);
    }
  }, [
    loadQueues,
    loadRepeatable,
    loadRedisMetrics,
    loadRuntimeStats,
    loadJobLog,
    nav,
    overviewDashboardTab,
  ]);

  useEffect(() => {
    void loadQueues();
    void loadRepeatable();
    void loadRedisMetrics(true);
    if (pollIntervalMs <= 0) {
      return undefined;
    }
    const intervalId = window.setInterval(() => {
      void loadQueues();
      void loadRepeatable();
      void loadRedisMetrics(true);
    }, pollIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [loadQueues, loadRepeatable, loadRedisMetrics, pollIntervalMs]);

  useEffect(() => {
    void fetchUiConfig()
      .then((config) => {
        setOperatorUi(config.operator);
      })
      .catch(() => {
        setOperatorUi({ ...DEFAULT_OPERATOR_UI });
      });
  }, []);

  const totals = useMemo(() => sumTotals(queues), [queues]);

  const aggregateQueueCounts = useMemo(
    () => ({
      waiting: totals.waiting,
      active: totals.active,
      completed: totals.completed,
      failed: totals.failed,
      delayed: totals.delayed,
      paused: totals.paused,
    }),
    [totals],
  );

  useEffect(() => {
    const totalActive = totals.active;
    setActiveSeries((previous) => {
      const next = [...previous, { t: Date.now(), active: totalActive }];
      /** Larger buffer so a future time-range control can filter the session chart meaningfully. */
      return next.slice(-512);
    });
  }, [totals.active]);

  useEffect(() => {
    if (nav !== 'overview' || overviewDashboardTab !== 'performance') {
      return;
    }
    void loadRuntimeStats();
  }, [nav, overviewDashboardTab, dashboardTimespanId, loadRuntimeStats]);

  useEffect(() => {
    if (nav !== 'log') {
      return undefined;
    }

    let cancelled = false;
    let intervalId: number | undefined;

    void loadJobLog(false);

    if (pollIntervalMs > 0) {
      intervalId = window.setInterval(() => {
        if (!cancelled) {
          void loadJobLog(true);
        }
      }, pollIntervalMs);
    }

    return () => {
      cancelled = true;
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [nav, loadJobLog, pollIntervalMs]);

  const jobsPollPreviousByIdRef = useRef<Map<string, { name: string }>>(new Map());
  const jobsPollSkipEventsRef = useRef(true);

  useLayoutEffect(() => {
    setJobsOffset(0);
  }, [selectedQueue, jobStatus]);

  useEffect(() => {
    if (!selectedQueue) {
      setJobs([]);
      jobsPollPreviousByIdRef.current = new Map();
      return;
    }

    jobsPollSkipEventsRef.current = true;
    jobsPollPreviousByIdRef.current = new Map();

    let cancelled = false;
    let intervalId: number | undefined;

    const applyJobs = (nextJobs: JobRow[], fromPoll: boolean) => {
      if (cancelled) {
        return;
      }
      const previousById = jobsPollPreviousByIdRef.current;
      if (
        fromPoll &&
        nav === 'queues' &&
        !jobsPollSkipEventsRef.current &&
        previousById.size > 0 &&
        jobStatus !== 'all' &&
        selectedQueue !== ALL_QUEUES_SENTINEL
      ) {
        reportJobListPollEvents(jobStatus, previousById, nextJobs, liveJobToastsEnabled);
      }
      const pollRowKey = (jobRow: JobRow) =>
        selectedQueue === ALL_QUEUES_SENTINEL && jobRow.queueName
          ? `${jobRow.queueName}:${jobRow.id}`
          : jobRow.id;
      jobsPollPreviousByIdRef.current = new Map(
        nextJobs.map((jobRow) => [pollRowKey(jobRow), { name: jobRow.name }]),
      );
      jobsPollSkipEventsRef.current = false;
      setJobs(nextJobs);
    };

    const loadJobsOnce = async (fromPoll: boolean) => {
      if (!fromPoll) {
        setJobsLoading(true);
      }
      try {
        const sliceEnd = jobsOffset + QUEUE_JOBS_PAGE_SIZE - 1;
        const response = await fetchJobs(selectedQueue, jobStatus, jobsOffset, sliceEnd);
        applyJobs(response.jobs, fromPoll);
      } catch {
        if (!cancelled) {
          if (!fromPoll) {
            setJobs([]);
            jobsPollPreviousByIdRef.current = new Map();
          }
        }
      } finally {
        if (!cancelled && !fromPoll) {
          setJobsLoading(false);
        }
      }
    };

    void loadJobsOnce(false);
    if (nav === 'queues' && pollIntervalMs > 0) {
      intervalId = window.setInterval(() => {
        void loadJobsOnce(true);
      }, pollIntervalMs);
    }

    return () => {
      cancelled = true;
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [
    selectedQueue,
    jobStatus,
    nav,
    pollIntervalMs,
    jobsOffset,
    jobsManualRefreshToken,
    liveJobToastsEnabled,
  ]);

  const skipFilterResetOnSelectedQueueOrJobStatusEffectRef = useRef(true);

  useEffect(() => {
    if (suppressFilterResetAfterBrowserHistoryRef.current) {
      suppressFilterResetAfterBrowserHistoryRef.current = false;
      return;
    }
    if (skipFilterResetOnSelectedQueueOrJobStatusEffectRef.current) {
      skipFilterResetOnSelectedQueueOrJobStatusEffectRef.current = false;
      return;
    }
    setSelectedJobNames([]);
    setDataPropertySelections({});
  }, [selectedQueue, jobStatus]);

  const selectedQueueSummary = useMemo(
    () => queues.find((queue) => queue.name === selectedQueue),
    [queues, selectedQueue],
  );

  const filteredJobs = useMemo(
    () =>
      filterJobs(jobs, {
        search: jobSearch,
        selectedJobNames,
        dataPropertySelections,
      }),
    [jobs, jobSearch, selectedJobNames, dataPropertySelections],
  );

  const barData = useMemo(
    () =>
      OVERVIEW_STATE_ORDER.map(({ status }) => ({
        label: BAR_SHORT_LABEL[status],
        value: totals[status],
        fill: JOB_STATE_STYLES[status].barFill,
      })),
    [totals],
  );

  const activeSeriesForChart = useMemo(() => {
    const durationMs = dashboardTimespanDurationMs(dashboardTimespanId);
    if (durationMs == null) {
      return activeSeries;
    }
    const cutoffTimestampMs = Date.now() - durationMs;
    return activeSeries.filter((point) => point.t >= cutoffTimestampMs);
  }, [activeSeries, dashboardTimespanId]);

  const lineData = useMemo(
    () =>
      activeSeriesForChart.map((point, index) => ({
        i: index,
        active: point.active,
      })),
    [activeSeriesForChart],
  );

  const slowestRunsForTimespan = useMemo(
    () => runtimeStats?.slowestRuns ?? [],
    [runtimeStats],
  );

  const failureShareInRuntimeSample = useMemo(() => {
    if (!runtimeStats) {
      return null;
    }
    const denominator =
      runtimeStats.completedJobsSampled + runtimeStats.failedJobsSampled;
    if (denominator === 0) {
      return null;
    }
    return Math.round((runtimeStats.failedJobsSampled / denominator) * 1000) / 10;
  }, [runtimeStats]);

  const pieByQueue = useMemo(() => {
    const rows = queues
      .map((queue) => ({
        name:
          queue.name.length > 18
            ? `${queue.name.slice(0, 16)}…`
            : queue.name,
        fullName: queue.name,
        value:
          queue.counts.waiting +
          queue.counts.active +
          queue.counts.delayed +
          queue.counts.failed,
      }))
      .filter((row) => row.value > 0)
      .sort((left, right) => right.value - left.value)
      .slice(0, 10);
    const otherSum = queues
      .slice()
      .sort((left, right) => {
        const leftSum =
          left.counts.waiting +
          left.counts.active +
          left.counts.delayed +
          left.counts.failed;
        const rightSum =
          right.counts.waiting +
          right.counts.active +
          right.counts.delayed +
          right.counts.failed;
        return rightSum - leftSum;
      })
      .slice(10)
      .reduce((accumulator, queue) => {
        return (
          accumulator +
          queue.counts.waiting +
          queue.counts.active +
          queue.counts.delayed +
          queue.counts.failed
        );
      }, 0);
    if (otherSum > 0) {
      rows.push({ name: 'Other', fullName: 'Other', value: otherSum });
    }
    return rows.length > 0 ? rows : [{ name: '—', fullName: '—', value: 1 }];
  }, [queues]);

  const failureRateByQueue = useMemo(() => {
    return queues
      .map((queue) => {
        const denominator = queue.counts.completed + queue.counts.failed;
        const failureShare =
          denominator === 0 ? 0 : (queue.counts.failed / denominator) * 100;
        return {
          label:
            queue.name.length > 16
              ? `${queue.name.slice(0, 14)}…`
              : queue.name,
          fullName: queue.name,
          failurePct: Math.round(failureShare * 10) / 10,
          denominator,
        };
      })
      .filter((row) => row.denominator > 0)
      .sort((left, right) => right.failurePct - left.failurePct)
      .slice(0, 12);
  }, [queues]);

  const topAvgRuntimeChart = useMemo(() => {
    if (!runtimeStats) {
      return [];
    }
    const slice = runtimeStats.byJobName.slice(0, 12);
    const n = slice.length;
    return slice.map((row, index) => {
      const position = n <= 1 ? 0 : index / (n - 1);
      const hue = 8 + (132 - 8) * position;
      return {
        chartLabel:
          row.name.length > 26 ? `${row.name.slice(0, 24)}…` : row.name,
        queueShort:
          row.queueName.length > 18
            ? `${row.queueName.slice(0, 16)}…`
            : row.queueName,
        avgMs: Math.round(row.avgMs),
        fullLabel: `${row.queueName} · ${row.name}`,
        barFill: `hsl(${hue} 70% 40%)`,
      };
    });
  }, [runtimeStats]);

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-background">
      {mobileNavOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] md:hidden"
          aria-hidden
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[min(18rem,calc(100vw-1rem))] flex-col overflow-hidden border-r border-border bg-card shadow-xl transition-transform duration-200 ease-out md:hidden',
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none',
        )}
        aria-hidden={!mobileNavOpen}
      >
        <AppSidebar
          activeNav={nav}
          onNavigate={handleNavSelect}
          onCloseMobile={() => setMobileNavOpen(false)}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          operatorUi={operatorUi}
        />
      </aside>

      <aside
        className={cn(
          'sticky top-0 hidden h-full min-h-0 shrink-0 flex-col overflow-hidden border-r border-border bg-card transition-[width] duration-200 ease-out md:flex',
          sidebarCollapsed ? 'w-16' : 'w-[13.5rem]',
        )}
      >
        <AppSidebar
          activeNav={nav}
          onNavigate={handleNavSelect}
          navCompact={sidebarCollapsed}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          operatorUi={operatorUi}
        />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3 sm:gap-3 sm:px-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-10 w-10 shrink-0 md:hidden"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" strokeWidth={1.75} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Open main navigation</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="hidden h-9 w-9 shrink-0 md:inline-flex"
                onClick={() => setSidebarCollapsed((previous) => !previous)}
                aria-expanded={!sidebarCollapsed}
                aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {sidebarCollapsed ? (
                  <PanelLeftOpen className="h-4 w-4" strokeWidth={1.75} />
                ) : (
                  <PanelLeftClose className="h-4 w-4" strokeWidth={1.75} />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            </TooltipContent>
          </Tooltip>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold tracking-tight">
              {nav === 'overview' && 'Dashboard'}
              {nav === 'queues' && 'Queues & jobs'}
              {nav === 'schedules' && 'Cron & intervals'}
              {nav === 'log' && 'Job log'}
              {nav === 'alerts' && 'Alerts'}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex max-w-[9rem] items-center gap-1.5 sm:max-w-none sm:gap-2">
                  <Switch
                    id="bullseye-live-job-toasts"
                    checked={liveJobToastsEnabled}
                    onCheckedChange={(checked) => handleLiveJobToastsChange(checked)}
                    aria-label="Live toasts for queue job list polling"
                  />
                  <Label
                    htmlFor="bullseye-live-job-toasts"
                    className="cursor-pointer truncate text-[10px] text-muted-foreground sm:whitespace-nowrap sm:text-[11px]"
                  >
                    Live toasts
                  </Label>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" className="max-w-[14rem] leading-snug">
                Notify when polling shows new completed/failed jobs or jobs leaving active/waiting (Queues view).
              </TooltipContent>
            </Tooltip>
            {SHOW_DASHBOARD_TIMESPAN_SELECTOR ? (
              <Select
                value={dashboardTimespanId}
                onValueChange={(value) => handleDashboardTimespanChange(value as DashboardTimespanId)}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SelectTrigger
                      aria-label="Dashboard time range (Overview: Active jobs chart + Performance metrics)"
                      className="h-8 w-[min(6.75rem,26vw)] shrink-0 px-2 text-[10px] sm:w-36 sm:text-xs"
                    >
                      <SelectValue />
                    </SelectTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="end" className="max-w-[14rem] leading-snug">
                    Time window for Overview charts (active jobs + performance metrics).
                  </TooltipContent>
                </Tooltip>
                <SelectContent position="popper" align="end" className="z-[80]">
                  {DASHBOARD_TIMESPAN_OPTIONS.map((option) => (
                    <SelectItem key={option.id} value={option.id} className="text-xs">
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <div className="inline-flex shrink-0 rounded-md shadow-sm">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 rounded-r-none border-r-0 px-2 text-xs sm:px-2.5"
                    onClick={() => void refreshAll()}
                    disabled={loading}
                    aria-label={`Refresh data (auto-refresh ${pollIntervalLabel})`}
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5 shrink-0', loading && 'animate-spin')} />
                    <span className="font-mono text-[10px] tabular-nums text-muted-foreground sm:text-[11px]">
                      {pollIntervalLabel}
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="end" className="max-w-[14rem] leading-snug">
                  Refresh queues and the current view now. Auto-refresh: {pollIntervalLabel}.
                </TooltipContent>
              </Tooltip>
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 w-8 shrink-0 rounded-l-none border-l px-0"
                        aria-label="Choose auto-refresh interval"
                      >
                        <ChevronDown className="mx-auto h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="end">
                    Choose how often data reloads in the background.
                  </TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" className="z-[80] min-w-36">
                  <DropdownMenuLabel className="text-xs">Auto-refresh</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={String(pollIntervalMs)}
                    onValueChange={(value) => {
                      handlePollIntervalMsChange(Number.parseInt(value, 10));
                    }}
                  >
                    {POLLING_INTERVAL_OPTIONS.map((option) => (
                      <DropdownMenuRadioItem key={option.valueMs} value={String(option.valueMs)}>
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
          {error && (
            <div className="mb-4 shrink-0 rounded-md border border-border bg-muted px-3 py-2 text-xs">
              {error}
            </div>
          )}

          <div
            key={nav}
            className={cn(
              'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
              'animate-in fade-in-0 zoom-in-[0.995] slide-in-from-bottom-1 duration-150 ease-out motion-reduce:animate-none',
            )}
          >
          {nav === 'overview' && (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <Tabs
                value={overviewDashboardTab}
                onValueChange={(value) =>
                  setOverviewDashboardTab(value as OverviewDashboardTab)
                }
              >
                <TabsList className="mb-1 h-auto w-full flex-wrap justify-start gap-1 bg-muted/30 p-1">
                  <TabsTrigger value="workload">Workload</TabsTrigger>
                  <TabsTrigger value="performance" className="gap-1.5">
                    <Timer className="h-3.5 w-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
                    Performance
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="workload" className="mt-4 space-y-4">
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                State totals and queue mix are <strong className="font-medium text-foreground">live</strong>{' '}
                (current depth in Redis). The <strong className="font-medium text-foreground">Active jobs</strong>{' '}
                chart uses polling snapshots from this session.{' '}
                <strong className="font-medium text-foreground">Performance</strong> uses a sample of the newest
                completed/failed jobs per queue (see tab intro).
              </p>
              <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
                <button
                  type="button"
                  onClick={() => goToAllQueuesJobView('all')}
                  className={cn(
                    'rounded-xl border border-border bg-card text-left text-card-foreground shadow-none',
                    'transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                  aria-label="Open all queues, all job states"
                >
                  <div className="p-3">
                    <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full ring-2 ring-border ring-inset bg-muted-foreground/35"
                        aria-hidden
                      />
                      All jobs
                    </p>
                    <p className="mt-1 font-mono text-xl font-semibold tabular-nums">
                      {sumTotalsAllStates(totals)}
                    </p>
                  </div>
                </button>
                {OVERVIEW_STATE_ORDER.map(({ status, title }) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => goToAllQueuesJobView(status)}
                    className={cn(
                      'rounded-xl border border-border bg-card text-left text-card-foreground shadow-none',
                      'transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    )}
                    aria-label={`Open all queues: ${title}`}
                  >
                    <div className="p-3">
                      <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        <span
                          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', JOB_STATE_STYLES[status].dot)}
                          aria-hidden
                        />
                        {title}
                      </p>
                      <p className="mt-1 font-mono text-xl font-semibold tabular-nums">
                        {totals[status]}
                      </p>
                    </div>
                  </button>
                ))}
              </div>

              <div className="grid gap-4 lg:grid-cols-5">
                <Card className="shadow-none lg:col-span-3">
                  <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-sm">Totals by state</CardTitle>
                    <CardDescription className="text-xs">
                      Aggregated across all queues
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="h-52 pb-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barData} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="hsl(var(--chart-grid))"
                          vertical={false}
                        />
                        <XAxis dataKey="label" tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} />
                        <YAxis tick={CHART_AXIS_TICK} width={32} axisLine={false} tickLine={false} allowDecimals={false} />
                        <RechartsTooltip {...RECHARTS_TOOLTIP_PROPS} />
                        <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={36}>
                          {barData.map((row, index) => (
                            <Cell key={index} fill={row.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="shadow-none lg:col-span-2">
                  <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-sm">Load by queue</CardTitle>
                    <CardDescription className="text-xs">
                      Waiting + active + delayed + failed
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="h-52 pb-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieByQueue}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={44}
                          outerRadius={72}
                          paddingAngle={2}
                          strokeWidth={0}
                        >
                          {pieByQueue.map((_, index) => (
                            <Cell key={index} fill={CHART_SLICE_FILLS[index % CHART_SLICE_FILLS.length]} />
                          ))}
                        </Pie>
                        <RechartsTooltip
                          {...RECHARTS_TOOLTIP_PROPS}
                          formatter={(value: number, _name: string, props: { payload?: { fullName?: string } }) => [
                            value,
                            props.payload?.fullName ?? '',
                          ]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              <Card className="shadow-none">
                <CardHeader className="pb-2 pt-4">
                  <CardTitle className="text-sm">Redis</CardTitle>
                  <CardDescription className="text-xs">
                    Live metrics via polling (INFO/DBSIZE)
                  </CardDescription>
                </CardHeader>
                <CardContent className="pb-4">
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <RedisMetricCard
                      label="Used memory"
                      value={formatBytesBinary(redisMetrics?.memory.usedBytes)}
                      info={REDIS_TOOLTIP_USED_MEMORY}
                      hint={
                        redisMetrics?.memory.maxBytes &&
                        redisMetrics.memory.maxBytes > 0 &&
                        redisMetrics.memory.usedBytes != null
                          ? `${Math.round(
                              (redisMetrics.memory.usedBytes /
                                redisMetrics.memory.maxBytes) *
                                100,
                            )}% of max`
                          : undefined
                      }
                    />
                    <RedisMetricCard
                      label="Peak memory"
                      value={formatBytesBinary(redisMetrics?.memory.peakBytes)}
                      info={REDIS_TOOLTIP_PEAK_MEMORY}
                      hint={
                        redisMetrics?.memory.fragmentationRatio != null
                          ? `Frag ${redisMetrics.memory.fragmentationRatio.toFixed(2)}`
                          : undefined
                      }
                    />
                    <RedisMetricCard
                      label="Connected clients"
                      value={
                        redisMetrics?.clients.connected != null
                          ? redisMetrics.clients.connected.toLocaleString('en-US')
                          : '—'
                      }
                      info={REDIS_TOOLTIP_CONNECTED_CLIENTS}
                      hint={
                        redisMetrics?.clients.blocked != null
                          ? `${redisMetrics.clients.blocked.toLocaleString('en-US')} blocked`
                          : undefined
                      }
                    />
                    <RedisMetricCard
                      label="Ops/sec"
                      value={
                        redisMetrics?.opsPerSec != null
                          ? Math.round(redisMetrics.opsPerSec).toLocaleString(
                              'en-US',
                            )
                          : '—'
                      }
                      info={REDIS_TOOLTIP_OPS_PER_SEC}
                    />
                    <RedisMetricCard
                      label="Keyspace hit rate"
                      value={
                        redisMetrics?.keyspace.hitRate != null
                          ? `${Math.round(
                              redisMetrics.keyspace.hitRate * 100,
                            )}%`
                          : '—'
                      }
                      info={REDIS_TOOLTIP_HIT_RATE}
                      hint={
                        redisMetrics?.keyspace.hits != null &&
                        redisMetrics?.keyspace.misses != null
                          ? `${redisMetrics.keyspace.hits.toLocaleString(
                              'en-US',
                            )} hits · ${redisMetrics.keyspace.misses.toLocaleString(
                              'en-US',
                            )} misses`
                          : undefined
                      }
                    />
                    <RedisMetricCard
                      label="DB keys"
                      value={
                        redisMetrics?.dbKeys != null
                          ? redisMetrics.dbKeys.toLocaleString('en-US')
                          : '—'
                      }
                      info={REDIS_TOOLTIP_DB_KEYS}
                    />
                    <RedisMetricCard
                      label="Uptime"
                      value={
                        redisMetrics?.uptimeSec != null
                          ? formatDurationCompact(
                              redisMetrics.uptimeSec * 1000,
                            )
                          : '—'
                      }
                      info={REDIS_TOOLTIP_UPTIME}
                    />
                    <RedisMetricCard
                      label="Role"
                      value={redisMetrics?.role ?? '—'}
                      info={REDIS_TOOLTIP_ROLE}
                      hint={
                        redisMetrics?.redisVersion
                          ? `Redis ${redisMetrics.redisVersion}`
                          : undefined
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-none">
                <CardHeader className="flex flex-row items-center gap-2 pb-2 pt-4">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <CardTitle className="text-sm">Active jobs · session</CardTitle>
                    <CardDescription className="text-xs">
                      Total active jobs over this session (auto-refresh polling)
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="h-36 pb-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={lineData} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="hsl(var(--chart-grid))"
                        vertical={false}
                      />
                      <XAxis dataKey="i" hide />
                      <YAxis tick={CHART_AXIS_TICK} width={28} allowDecimals={false} axisLine={false} tickLine={false} />
                      <RechartsTooltip {...RECHARTS_TOOLTIP_PROPS} />
                      <Line
                        type="monotone"
                        dataKey="active"
                        stroke="hsl(var(--foreground))"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
                </TabsContent>

                <TabsContent value="performance" className="mt-4 space-y-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
                    <p className="max-w-[52rem] text-[11px] leading-relaxed text-muted-foreground">
                      Metrics use a <strong className="font-medium text-foreground">sample</strong> of the newest
                      completed and failed jobs per queue in Redis (up to the per-queue cap). Histogram, per-job
                      averages, slowest runs, and sampled counts are all derived from that same sample.
                    </p>
                    <div className="flex w-full min-w-0 flex-col gap-1 sm:w-64">
                      <Label htmlFor="performance-queue-filter" className="text-[10px] text-muted-foreground">
                        Queue filter
                      </Label>
                      <Select
                        value={performanceStatsQueue === '' ? '__all__' : performanceStatsQueue}
                        onValueChange={(value) =>
                          setPerformanceStatsQueue(value === '__all__' ? '' : value)
                        }
                      >
                        <SelectTrigger
                          id="performance-queue-filter"
                          className="h-9 text-xs"
                          aria-label="Performance metrics queue filter"
                        >
                          <SelectValue placeholder="All queues" />
                        </SelectTrigger>
                        <SelectContent position="popper" className="z-[80]">
                          <SelectItem value="__all__" className="text-xs">
                            All queues
                          </SelectItem>
                          {queues.map((queue) => (
                            <SelectItem key={queue.name} value={queue.name} className="font-mono text-xs">
                              {queue.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Card className="shadow-none">
                      <CardContent className="p-3">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Sampled completed
                        </p>
                        <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
                          {runtimeStatsLoading ? '…' : (runtimeStats?.completedJobsSampled ?? '—')}
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="shadow-none">
                      <CardContent className="p-3">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Sampled failed
                        </p>
                        <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
                          {runtimeStatsLoading ? '…' : (runtimeStats?.failedJobsSampled ?? '—')}
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="shadow-none">
                      <CardContent className="p-3">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Jobs / queue cap
                        </p>
                        <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
                          {runtimeStats?.perQueueSampleLimit ?? '—'}
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="shadow-none">
                      <CardContent className="p-3">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Failure share (in sample)
                        </p>
                        <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
                          {runtimeStatsLoading
                            ? '…'
                            : failureShareInRuntimeSample == null
                              ? '—'
                              : `${failureShareInRuntimeSample}%`}
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card className="shadow-none">
                      <CardHeader className="pb-2 pt-4">
                        <CardTitle className="text-sm">Slowest job types</CardTitle>
                        <CardDescription className="text-xs">
                          Mean processing time (finished − started) for sampled completions
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="h-64 pb-4">
                        {runtimeStatsLoading ? (
                          <p className="text-xs text-muted-foreground">Loading runtime stats…</p>
                        ) : topAvgRuntimeChart.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            No timed completions in sample.
                          </p>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              layout="vertical"
                              data={topAvgRuntimeChart}
                              margin={{ top: 4, right: 16, bottom: 4, left: 4 }}
                            >
                              <CartesianGrid
                                horizontal={false}
                                strokeDasharray="3 3"
                                stroke="hsl(var(--chart-grid))"
                              />
                              <XAxis
                                type="number"
                                tick={CHART_AXIS_TICK}
                                tickFormatter={(value: number) =>
                                  value >= 1000 ? `${value / 1000}s` : `${value}ms`
                                }
                              />
                              <YAxis
                                type="category"
                                dataKey="chartLabel"
                                width={112}
                                tick={CHART_AXIS_TICK_SM}
                                axisLine={false}
                                tickLine={false}
                              />
                              <RechartsTooltip
                                {...RECHARTS_TOOLTIP_PROPS}
                                formatter={(value: number) => [
                                  formatDurationCompact(value),
                                  'Average',
                                ]}
                                labelFormatter={(_, payload) =>
                                  payload?.[0]?.payload?.fullLabel ?? ''
                                }
                              />
                              <Bar
                                dataKey="avgMs"
                                radius={[0, 4, 4, 0]}
                                maxBarSize={24}
                              >
                                {topAvgRuntimeChart.map((row, barIndex) => (
                                  <Cell key={`avg-${barIndex}`} fill={row.barFill} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="shadow-none">
                      <CardHeader className="pb-2 pt-4">
                        <CardTitle className="text-sm">Completion duration mix</CardTitle>
                        <CardDescription className="text-xs">
                          Distribution of durations in the sampled completed jobs
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="h-64 pb-4">
                        {runtimeStatsLoading ? (
                          <p className="text-xs text-muted-foreground">Loading…</p>
                        ) : !runtimeStats || runtimeStats.durationHistogram.every((bucket) => bucket.count === 0) ? (
                          <p className="text-xs text-muted-foreground">No histogram data.</p>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={runtimeStats.durationHistogram}
                              margin={{ top: 4, right: 8, bottom: 48, left: -18 }}
                            >
                              <CartesianGrid
                                strokeDasharray="3 3"
                                stroke="hsl(var(--chart-grid))"
                                vertical={false}
                              />
                              <XAxis
                                dataKey="label"
                                tick={CHART_AXIS_TICK_SM}
                                interval={0}
                                angle={-28}
                                textAnchor="end"
                                height={52}
                              />
                              <YAxis
                                tick={CHART_AXIS_TICK}
                                width={28}
                                allowDecimals={false}
                                axisLine={false}
                                tickLine={false}
                              />
                              <RechartsTooltip {...RECHARTS_TOOLTIP_PROPS} />
                              <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={48}>
                                {runtimeStats.durationHistogram.map((_, bucketIndex, arr) => {
                                  const position =
                                    arr.length <= 1 ? 0.5 : bucketIndex / (arr.length - 1);
                                  const lightness = 30 + 24 * (1 - position);
                                  return (
                                    <Cell
                                      key={`hist-${bucketIndex}`}
                                      fill={`hsl(152 52% ${lightness}%)`}
                                    />
                                  );
                                })}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card className="shadow-none">
                      <CardHeader className="pb-2 pt-4">
                        <CardTitle className="text-sm">Failure rate by queue</CardTitle>
                        <CardDescription className="text-xs">
                          Failed ÷ (failed + completed) from live counts
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="h-64 pb-4">
                        {failureRateByQueue.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            No completed/failed history on counters.
                          </p>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={failureRateByQueue} margin={{ top: 4, right: 8, bottom: 52, left: -18 }}>
                              <CartesianGrid
                                strokeDasharray="3 3"
                                stroke="hsl(var(--chart-grid))"
                                vertical={false}
                              />
                              <XAxis
                                dataKey="label"
                                tick={CHART_AXIS_TICK_SM}
                                interval={0}
                                angle={-28}
                                textAnchor="end"
                                height={52}
                              />
                              <YAxis
                                domain={[0, 100]}
                                tickFormatter={(tick: number) => `${tick}%`}
                                tick={CHART_AXIS_TICK}
                                width={36}
                                axisLine={false}
                                tickLine={false}
                              />
                              <RechartsTooltip
                                {...RECHARTS_TOOLTIP_PROPS}
                                formatter={(value: number) => [`${value}%`, 'Failures']}
                                labelFormatter={(_, payload) =>
                                  payload?.[0]?.payload?.fullName ?? ''
                                }
                              />
                              <Bar
                                dataKey="failurePct"
                                fill="hsl(0 72% 48%)"
                                radius={[3, 3, 0, 0]}
                                maxBarSize={40}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="shadow-none">
                      <CardHeader className="pb-2 pt-4">
                        <CardTitle className="text-sm">Slowest recent runs</CardTitle>
                        <CardDescription className="text-xs">
                          Slowest runs from the same sample (by processing duration)
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="max-h-72 overflow-auto pb-4 pt-0">
                        {runtimeStatsLoading ? (
                          <p className="text-xs text-muted-foreground">Loading…</p>
                        ) : !runtimeStats || slowestRunsForTimespan.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No timed runs in sample.</p>
                        ) : (
                          <div className="rounded-md border border-border">
                            <table className="w-full border-collapse text-[11px]">
                              <thead className="sticky top-0 z-[1] bg-muted/90 backdrop-blur">
                                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                                  <th className="px-3 py-2 font-medium">Duration</th>
                                  <th className="px-3 py-2 font-medium">Outcome</th>
                                  <th className="px-3 py-2 font-medium">Job</th>
                                  <th className="px-3 py-2 font-medium">Queue</th>
                                  <th className="px-3 py-2 font-medium">Finished</th>
                                </tr>
                              </thead>
                              <tbody>
                                {slowestRunsForTimespan.map((run, runIndex) => {
                                  const heat =
                                    slowestRunsForTimespan.length <= 1
                                      ? 0
                                      : runIndex / (slowestRunsForTimespan.length - 1);
                                  const durationHue = 12 + (95 - 12) * heat;
                                  return (
                                  <tr key={`${run.queueName}:${run.id}:${run.finishedOn}`} className="border-b border-border last:border-0">
                                    <td
                                      className="px-3 py-1.5 font-mono tabular-nums"
                                      style={{ color: `hsl(${durationHue} 65% 38%)` }}
                                    >
                                      {formatDurationCompact(run.durationMs)}
                                    </td>
                                    <td className="px-3 py-1.5">
                                      <span
                                        className={cn(
                                          'rounded px-1.5 py-px text-[10px] font-medium uppercase',
                                          run.status === 'failed'
                                            ? 'border border-red-500/35 bg-red-500/12 text-red-800 dark:text-red-300'
                                            : 'border border-emerald-500/35 bg-emerald-500/12 text-emerald-800 dark:text-emerald-300',
                                        )}
                                      >
                                        {run.status}
                                      </span>
                                    </td>
                                    <td className="max-w-[140px] truncate px-3 py-1.5 font-mono" title={run.name}>
                                      {run.name}
                                    </td>
                                    <td className="max-w-[100px] truncate px-3 py-1.5 font-mono text-muted-foreground">
                                      {run.queueName}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                                      {formatTimestampPretty(run.finishedOn)}
                                    </td>
                                  </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}

          {nav === 'queues' && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex min-h-0 flex-1 flex-col md:flex-row">
              <div
                className={cn(
                  'flex min-h-0 w-full shrink-0 flex-col border-border md:h-auto md:border-r',
                  mobileQueueJobsOpen
                    ? 'hidden border-b-0 md:flex md:max-h-none md:flex-none md:border-b-0'
                    : 'flex flex-1 border-b md:flex-none md:max-h-none md:border-b-0',
                )}
                style={
                  isMdUp
                    ? { width: queueListWidthPx, flexShrink: 0 }
                    : undefined
                }
              >
                <div className="shrink-0 border-b border-border bg-muted/30 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Queues ({queues.length})
                  </p>
                  <p className="mt-1 text-[10px] leading-snug text-muted-foreground md:hidden">
                    Tap a queue to open jobs for that queue.
                  </p>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-1.5 md:p-1">
                  <div className="mb-1.5 flex min-h-11 items-stretch gap-0.5 md:min-h-0">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => selectQueueForView(ALL_QUEUES_SENTINEL)}
                      className={cn(
                        'h-auto min-h-11 min-w-0 flex-1 flex-col items-stretch justify-start gap-0.5 rounded-md px-2 py-2 text-left text-xs font-normal whitespace-normal active:bg-muted/80 md:min-h-0 md:py-1.5',
                        selectedQueue === ALL_QUEUES_SENTINEL
                          ? 'bg-muted font-medium text-foreground hover:bg-muted'
                          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                      )}
                    >
                      <span className="flex w-full min-w-0 flex-wrap items-center justify-start gap-x-2 gap-y-1">
                        <span className="min-w-0 flex-1 text-left font-medium">
                          All queues
                        </span>
                        <ChevronRight
                          className={cn(
                            'h-4 w-4 shrink-0 text-muted-foreground md:h-3 md:w-3',
                            selectedQueue === ALL_QUEUES_SENTINEL
                              ? 'md:opacity-100'
                              : 'opacity-70 md:opacity-0',
                          )}
                          aria-hidden
                        />
                      </span>
                      <QueueStatusSegmentBar counts={aggregateQueueCounts} />
                    </Button>
                  </div>
                  {queues.map((queue) => (
                    <div
                      key={queue.name}
                      className="mb-1.5 flex min-h-11 items-stretch gap-0.5 last:mb-0 md:min-h-0"
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => selectQueueForView(queue.name)}
                        className={cn(
                          'h-auto min-h-11 min-w-0 flex-1 flex-col items-stretch justify-start gap-0.5 rounded-md px-2 py-2 text-left text-xs font-normal whitespace-normal active:bg-muted/80 md:min-h-0 md:py-1.5',
                          selectedQueue === queue.name
                            ? 'bg-muted font-medium text-foreground hover:bg-muted'
                            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                        )}
                      >
                        <span className="flex w-full min-w-0 flex-wrap items-center justify-start gap-x-2 gap-y-1">
                          {queue.isPaused ? (
                            <Pause
                              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                              strokeWidth={1.75}
                              aria-label="Queue paused"
                            />
                          ) : null}
                          <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere] text-left font-mono">
                            {queue.name}
                          </span>
                          <ChevronRight
                            className={cn(
                              'h-4 w-4 shrink-0 text-muted-foreground md:h-3 md:w-3',
                              selectedQueue === queue.name ? 'md:opacity-100' : 'opacity-70 md:opacity-0',
                            )}
                            aria-hidden
                          />
                        </span>
                        <QueueStatusSegmentBar counts={queue.counts} />
                      </Button>
                      <div className="flex shrink-0 items-stretch py-0.5 md:py-0">
                        <QueueActionsMenu
                          queueName={queue.name}
                          isPaused={queue.isPaused}
                          triggerClassName="h-11 w-9 rounded-md md:h-9 md:w-8"
                          onAfterChange={async () => {
                            await refreshQueueSummaries();
                            bumpJobsRefresh();
                          }}
                          onAddJob={openCreateJobModalForQueue}
                        />
                      </div>
                    </div>
                  ))}
                  {!loading && queues.length === 0 && (
                    <p className="p-3 text-[11px] text-muted-foreground">No queues.</p>
                  )}
                </div>
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Queue list width"
                    onMouseDown={queueListResizePointerDown}
                    className={cn(
                      'hidden shrink-0 touch-none md:block md:h-auto md:self-stretch',
                      'w-1 min-w-1 cursor-col-resize',
                      'border-0 bg-transparent p-0',
                      'hover:bg-border/70',
                      queueListResizeActive && 'bg-border',
                    )}
                  />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[12rem] leading-snug">
                  Drag to resize the queue list (saved for this browser).
                </TooltipContent>
              </Tooltip>

              <div
                className={cn(
                  'flex min-h-0 min-w-0 flex-1 flex-col',
                  mobileQueueJobsOpen ? 'flex' : 'hidden md:flex',
                )}
              >
                {!selectedQueue ? (
                  <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
                    Select a queue or &quot;All queues&quot;
                  </div>
                ) : (
                  <>
                    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-2 py-2.5 sm:px-4 sm:py-3 md:px-3">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 shrink-0 md:hidden"
                            onClick={() => setMobileQueueJobsOpen(false)}
                            aria-label="Back to queue list"
                          >
                            <ChevronLeft className="h-5 w-5" strokeWidth={1.75} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Back to queue list</TooltipContent>
                      </Tooltip>
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 md:flex-auto">
                        {selectedQueue !== ALL_QUEUES_SENTINEL && selectedQueueSummary?.isPaused ? (
                          <Pause
                            className="h-4 w-4 shrink-0 text-muted-foreground"
                            strokeWidth={1.75}
                            aria-label="Queue is paused"
                          />
                        ) : null}
                        <span
                          className={cn(
                            'min-w-0 truncate text-sm font-semibold',
                            selectedQueue === ALL_QUEUES_SENTINEL
                              ? 'font-sans'
                              : 'font-mono',
                          )}
                        >
                          {selectedQueue === ALL_QUEUES_SENTINEL ? 'All queues' : selectedQueue}
                        </span>
                        {selectedQueue !== ALL_QUEUES_SENTINEL && selectedQueueSummary?.isPaused ? (
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            paused
                          </Badge>
                        ) : null}
                      </div>
                      {selectedQueue && selectedQueue !== ALL_QUEUES_SENTINEL ? (
                        <QueueActionsMenu
                          queueName={selectedQueue}
                          isPaused={Boolean(selectedQueueSummary?.isPaused)}
                          triggerClassName="h-9 w-9 shrink-0"
                          onAfterChange={async () => {
                            await refreshQueueSummaries();
                            bumpJobsRefresh();
                          }}
                          onAddJob={openCreateJobModalForQueue}
                        />
                      ) : null}
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 sm:p-4">
                      <Tabs
                        value={jobStatus}
                        onValueChange={(value) => setJobStatus(value as JobsQueryStatus)}
                      >
                        <TabsList className="no-scrollbar h-auto w-full shrink-0 flex-wrap justify-start gap-1 overflow-x-auto scroll-pb-1 border-0 bg-transparent p-0 pb-0.5 [-webkit-overflow-scrolling:touch]">
                          {QUEUE_JOBS_TAB_ORDER.map(({ status, title }) => {
                            const tabCount =
                              status === 'all'
                                ? selectedQueue === ALL_QUEUES_SENTINEL
                                  ? sumTotalsAllStates(totals)
                                  : sumCountsAllStates(selectedQueueSummary)
                                : selectedQueue === ALL_QUEUES_SENTINEL
                                  ? totals[status]
                                  : countForStatus(selectedQueueSummary, status);
                            return (
                              <TabsTrigger
                                key={status}
                                value={status}
                                className={cn('gap-1.5 text-[11px]', JOB_STATE_TAB_TRIGGER_CLASSES)}
                              >
                                {status === 'all' ? (
                                  <span
                                    className="h-1.5 w-1.5 shrink-0 rounded-full ring-2 ring-border ring-inset bg-muted-foreground/35"
                                    aria-hidden
                                  />
                                ) : (
                                  <span
                                    className={cn(
                                      'h-1.5 w-1.5 shrink-0 rounded-full',
                                      JOB_STATE_STYLES[status].dot,
                                    )}
                                    aria-hidden
                                  />
                                )}
                                <span>{title}</span>
                                <span className="min-w-[1.25rem] rounded-md bg-muted/60 px-1.5 py-px text-center font-mono text-[10px] tabular-nums text-muted-foreground group-data-[state=active]:bg-muted group-data-[state=active]:text-foreground">
                                  {tabCount}
                                </span>
                              </TabsTrigger>
                            );
                          })}
                        </TabsList>
                      </Tabs>

                      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
                        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <QueueJobFilters
                              jobs={jobs}
                              jobsLoading={jobsLoading}
                              jobSearch={jobSearch}
                              setJobSearch={setJobSearch}
                              selectedJobNames={selectedJobNames}
                              setSelectedJobNames={setSelectedJobNames}
                              dataPropertySelections={dataPropertySelections}
                              setDataPropertySelections={setDataPropertySelections}
                            />
                          </div>
                        </div>

                        <QueueJobsTable
                          allJobsInSlice={jobs}
                          jobs={filteredJobs}
                          totalLoaded={jobs.length}
                          pageOffset={jobsOffset}
                          pageSize={QUEUE_JOBS_PAGE_SIZE}
                          canPageBack={jobsOffset > 0}
                          canPageForward={jobs.length === QUEUE_JOBS_PAGE_SIZE}
                          onPageBack={() =>
                            setJobsOffset((previous) =>
                              Math.max(0, previous - QUEUE_JOBS_PAGE_SIZE),
                            )
                          }
                          onPageForward={() =>
                            setJobsOffset((previous) => previous + QUEUE_JOBS_PAGE_SIZE)
                          }
                          loading={jobsLoading}
                          fillHeight
                          queueName={selectedQueue ?? ''}
                          jobStatus={jobStatus}
                          highlightJobKey={jobDetailHighlightKey}
                          onPromoteJob={handlePromoteJob}
                          onDuplicateJob={openDuplicateJobModal}
                          onJobsMutated={() => bumpJobsRefresh()}
                          onSelectJob={(job) => {
                            if (!selectedQueue) {
                              return;
                            }
                            const rowQueue =
                              job.queueName ??
                              (selectedQueue !== ALL_QUEUES_SENTINEL ? selectedQueue : null);
                            if (!rowQueue) {
                              return;
                            }
                            setJobDetailContext({
                              job,
                              queueName: rowQueue,
                              modalJobStatus:
                                job.state ??
                                (jobStatus !== 'all' ? jobStatus : undefined),
                            });
                          }}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
              </div>
            </div>
          )}

          {nav === 'schedules' && (
            <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-none">
              <CardHeader className="shrink-0 px-4 pb-2 pt-4 sm:px-6">
                <CardTitle className="text-sm">Repeatable jobs</CardTitle>
                <CardDescription className="text-xs">
                  Cron expressions and fixed intervals from Bull{' '}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">opts.repeat</code>
                </CardDescription>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-0 sm:px-6 sm:pb-6">
                <div className="min-h-0 flex-1 touch-pan-x overflow-auto rounded-md border border-border [-webkit-overflow-scrolling:touch]">
                  <table className="w-full min-w-[720px] border-collapse text-[11px] lg:min-w-0">
                    <thead className="sticky top-0 z-[1] bg-muted/90 backdrop-blur">
                      <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Queue</th>
                        <th className="px-3 py-2 font-medium">Job name</th>
                        <th className="px-3 py-2 font-medium">Schedule</th>
                        <th className="px-3 py-2 font-medium">Every</th>
                        <th className="px-3 py-2 font-medium">Next run</th>
                        <th className="px-3 py-2 font-medium">TZ</th>
                        <th className="px-3 py-2 font-medium">End</th>
                      </tr>
                    </thead>
                    <tbody>
                      {repeatableJobs.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                            No repeatable jobs registered.
                          </td>
                        </tr>
                      ) : (
                        repeatableJobs.map((job) => (
                          <tr key={`${job.queueName}:${job.key}`} className="border-b border-border last:border-0">
                            <td className="max-w-[10rem] truncate px-3 py-1.5 font-mono" title={job.queueName}>
                              {job.queueName}
                            </td>
                            <td className="max-w-[140px] truncate px-3 py-1.5 font-mono">{job.name}</td>
                            <td className="max-w-[min(340px,42vw)] px-3 py-1.5 align-top">
                              {job.cron ? (
                                <div className="space-y-1">
                                  <p className="text-[11px] leading-snug text-foreground">
                                    {formatCronNaturalLanguage(job.cron)}
                                  </p>
                                  <p className="break-all font-mono text-[10px] text-muted-foreground">{job.cron}</p>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="max-w-[220px] px-3 py-1.5 align-top">
                              {job.every != null && job.every > 0 ? (
                                <div className="space-y-1">
                                  <p className="text-[11px] leading-snug text-foreground">
                                    {formatEveryNaturalLanguage(job.every)}
                                  </p>
                                  <p className="font-mono text-[10px] text-muted-foreground">{formatEveryMs(job.every)}</p>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td
                              className="whitespace-nowrap px-3 py-1.5"
                              title={job.next ? formatTimestampIso(job.next) : undefined}
                            >
                              {formatNextRun(job.next)}
                            </td>
                            <td className="max-w-[100px] truncate px-3 py-1.5 text-muted-foreground">
                              {job.tz || '—'}
                            </td>
                            <td
                              className="whitespace-nowrap px-3 py-1.5 text-muted-foreground"
                              title={job.endDate ? formatTimestampIso(job.endDate) : undefined}
                            >
                              {job.endDate ? formatNextRun(job.endDate) : '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {nav === 'log' && (
            <Card className="flex min-h-0 flex-1 flex-col overflow-hidden shadow-none">
              <CardHeader className="flex shrink-0 flex-col gap-3 px-4 pb-2 pt-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:px-6">
                <div>
                  <CardTitle className="text-sm">Cross-queue activity</CardTitle>
                  <CardDescription className="text-xs">
                    Merged sample from all queues (sorted by started time:{' '}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                      processedOn
                    </code>{' '}
                    → else enqueue time). Deep pages may be truncated — narrow the state filter if
                    needed.
                  </CardDescription>
                </div>
                <div className="flex w-full min-w-0 flex-wrap items-stretch gap-2 sm:w-auto sm:items-end">
                  <JobLogStatusMultiSelect
                    label="State"
                    className="w-full min-w-0 sm:w-56"
                    selected={jobLogStatuses}
                    onChange={(next) => {
                      setJobLogStatuses(next);
                      setJobLogOffset(0);
                    }}
                  />
                </div>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-4 pt-0 sm:px-6 sm:pb-6">
                <div className="shrink-0 text-[11px] text-muted-foreground">
                  {jobLogData != null && (
                    <span>
                      Merged sample:{' '}
                      <strong className="font-mono text-foreground">
                        {jobLogData.sampleSize.toLocaleString()}
                      </strong>{' '}
                      rows
                      {jobLogLoading && ' · Loading…'}
                    </span>
                  )}
                  {jobLogData == null && jobLogLoading && <span>Loading…</span>}
                </div>

                <div className="min-h-0 flex-1 touch-pan-x overflow-auto rounded-md border border-border [-webkit-overflow-scrolling:touch]">
                  <table className="w-full min-w-[520px] border-collapse text-[11px] sm:min-w-0">
                    <thead className="sticky top-0 z-[1] bg-muted/90 backdrop-blur">
                      <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Queue</th>
                        <th className="px-3 py-2 font-medium">Job</th>
                        <th className="px-3 py-2 font-medium">State</th>
                        <th className="px-3 py-2 font-medium">Started</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobLogLoading && (
                        <tr>
                          <td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">
                            Loading…
                          </td>
                        </tr>
                      )}
                      {!jobLogLoading &&
                        jobLogData?.items.map((row) => {
                          const styles = JOB_STATE_STYLES[row.state];
                          const startedMs = row.job.processedOn;
                          return (
                            <tr
                              key={`${row.queueName}:${row.job.id}`}
                              data-bullseye-log-row={`${row.queueName}:${row.job.id}`}
                              className={cn(
                                'cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted/60',
                                jobDetailHighlightKey === `${row.queueName}:${row.job.id}` &&
                                  'bg-primary/10 ring-1 ring-inset ring-primary/25',
                              )}
                              onClick={() =>
                                setJobDetailContext({
                                  job: row.job,
                                  queueName: row.queueName,
                                  modalJobStatus: row.state,
                                })
                              }
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  setJobDetailContext({
                                    job: row.job,
                                    queueName: row.queueName,
                                    modalJobStatus: row.state,
                                  });
                                }
                              }}
                              tabIndex={0}
                              role="button"
                            >
                              <td className="max-w-[min(200px,28vw)] truncate px-3 py-1.5 font-mono text-[10px]">
                                {row.queueName}
                              </td>
                              <td className="max-w-[min(240px,36vw)] truncate px-3 py-1.5 font-medium">
                                {row.job.name}
                              </td>
                              <td className="px-3 py-1.5">
                                <span
                                  className={cn(
                                    'inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-[10px] font-medium',
                                    styles.countBadge,
                                  )}
                                >
                                  <span
                                    className={cn('h-1.5 w-1.5 shrink-0 rounded-full', styles.dot)}
                                    aria-hidden
                                  />
                                  {statusTitle(row.state)}
                                </span>
                              </td>
                              <td
                                className="whitespace-nowrap px-3 py-1.5 text-muted-foreground"
                                title={
                                  startedMs != null ? formatTimestampIso(startedMs) : undefined
                                }
                              >
                                {startedMs != null ? formatTimestampPretty(startedMs) : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      {!jobLogLoading &&
                        jobLogData != null &&
                        jobLogData.items.length === 0 && (
                          <tr>
                            <td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">
                              No rows in this merged sample.
                            </td>
                          </tr>
                        )}
                    </tbody>
                  </table>
                </div>

                {jobLogData != null && (() => {
                  const jobLogTotalPages = Math.max(
                    1,
                    Math.ceil(jobLogData.sampleSize / LOG_PAGE_SIZE),
                  );
                  const jobLogCurrentPage = Math.min(
                    jobLogTotalPages,
                    Math.floor(jobLogOffset / LOG_PAGE_SIZE) + 1,
                  );
                  const pageItems = jobLogPaginationPages(jobLogCurrentPage, jobLogTotalPages);
                  return (
                    <div className="flex shrink-0 flex-col items-stretch gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-center text-[10px] text-muted-foreground sm:text-left">
                        Page{' '}
                        <span className="font-mono tabular-nums text-foreground">
                          {jobLogCurrentPage}
                        </span>{' '}
                        of{' '}
                        <span className="font-mono tabular-nums text-foreground">
                          {jobLogTotalPages}
                        </span>
                        <span className="text-muted-foreground/80">
                          {' '}
                          · {LOG_PAGE_SIZE} per page
                        </span>
                      </p>
                      <div className="flex flex-wrap items-center justify-center gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-10 min-w-10 px-2 text-[11px] sm:h-8 sm:min-w-8"
                              disabled={jobLogOffset <= 0 || jobLogLoading}
                              onClick={() =>
                                setJobLogOffset((previous) =>
                                  Math.max(0, previous - LOG_PAGE_SIZE),
                                )
                              }
                            >
                              Prev
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top">Previous page of the merged job log</TooltipContent>
                        </Tooltip>
                        {pageItems.map((item, index) =>
                          item === 'gap' ? (
                            <span
                              key={`gap-${index}`}
                              className="px-1 font-mono text-[11px] text-muted-foreground"
                              aria-hidden
                            >
                              …
                            </span>
                          ) : (
                            <Tooltip key={item}>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  variant={item === jobLogCurrentPage ? 'default' : 'outline'}
                                  size="sm"
                                  className="h-10 min-w-10 px-2 font-mono text-[11px] tabular-nums sm:h-8 sm:min-w-8"
                                  disabled={jobLogLoading || item === jobLogCurrentPage}
                                  onClick={() =>
                                    setJobLogOffset((item - 1) * LOG_PAGE_SIZE)
                                  }
                                  aria-label={`Page ${item}`}
                                  aria-current={item === jobLogCurrentPage ? 'page' : undefined}
                                >
                                  {item}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                {item === jobLogCurrentPage
                                  ? `Current page (${LOG_PAGE_SIZE} rows per page)`
                                  : `Go to page ${item}`}
                              </TooltipContent>
                            </Tooltip>
                          ),
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-10 min-w-10 px-2 text-[11px] sm:h-8 sm:min-w-8"
                              disabled={!jobLogData.hasMore || jobLogLoading}
                              onClick={() =>
                                setJobLogOffset((previous) => previous + LOG_PAGE_SIZE)
                              }
                            >
                              Next
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top">Next page when more rows are available</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          {nav === 'alerts' && (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <Suspense
                fallback={
                  <div className="flex min-h-[12rem] flex-1 items-center justify-center text-sm text-muted-foreground">
                    Loading alerts…
                  </div>
                }
              >
                <AlertsPanelLazy queues={queues} />
              </Suspense>
            </div>
          )}
          </div>
        </main>
      </div>

      {jobDetailContext !== null && (
        <Suspense fallback={null}>
          <JobDetailDrawerLazy
            open
            queueName={jobDetailContext.queueName}
            jobStatus={
              jobDetailContext.modalJobStatus ??
              jobDetailContext.job.state ??
              (jobStatus !== 'all' ? jobStatus : 'waiting')
            }
            initialJob={jobDetailContext.job}
            onClose={() => setJobDetailContext(null)}
            onDuplicate={openDuplicateJobModal}
          />
        </Suspense>
      )}

      {commandPaletteOpen && (
        <Suspense fallback={null}>
          <BullseyeCommandMenuLazy
            open={commandPaletteOpen}
            onOpenChange={setCommandPaletteOpen}
            queues={queues}
            onSelectQueue={handleCommandPaletteSelectQueue}
            onSelectJobNameFilter={handleCommandPaletteSelectJobNameFilter}
          />
        </Suspense>
      )}

      {(() => {
        const writeQueueName =
          jobWriteQueueName ??
          (selectedQueue != null && selectedQueue !== ALL_QUEUES_SENTINEL
            ? selectedQueue
            : null);
        return writeQueueName && jobWriteSeed ? (
          <QueueJobWriteModal
            open={jobWriteOpen}
            onOpenChange={(open) => {
              setJobWriteOpen(open);
              if (!open) {
                setJobWriteQueueName(null);
              }
            }}
            mode={jobWriteMode}
            queueName={writeQueueName}
            sourceJobId={jobWriteSourceId}
            initialJobName={jobWriteSeed.name}
            initialData={jobWriteSeed.data}
            initialOpts={jobWriteSeed.opts}
            onSuccess={() => bumpJobsRefresh()}
          />
        ) : null;
      })()}
    </div>
  );
}
