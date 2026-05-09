import { jsonToTableCellString } from '@/components/json-block';
import {
  QueueJobsTimeframeHeatmap,
  jobMatchesTimeframeBrush,
  type TimeframeBrush,
} from '@/components/queue-jobs-timeframe-heatmap';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ALL_QUEUES_SENTINEL,
  removeQueueJob,
  retryQueueJob,
  type JobRow,
  type JobsQueryStatus,
  type JobStatus,
} from '@/lib/api';
import { toast } from '@/lib/bullseye-toast';
import {
  formatProgressValue,
  formatTimestampIso,
  formatTimestampPretty,
} from '@/lib/format';
import { JOB_STATE_STYLES, OVERVIEW_STATE_ORDER } from '@/lib/status-styles';
import { cn } from '@/lib/utils';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  CopyPlus,
  RotateCcw,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';

const COL_WIDTHS_KEY = 'bullseye-jobs-table-col-widths';
const COL_VISIBLE_KEY = 'bullseye-jobs-table-visible';

type SortKey = 'id' | 'name' | 'payload' | 'error' | 'progress' | 'attempts' | 'created';
type SortDir = 'asc' | 'desc';

type ColKey = 'id' | 'name' | 'payload' | 'error' | 'progress' | 'attempts' | 'created';

const DEFAULT_WIDTHS: Record<ColKey, number> = {
  id: 84,
  name: 128,
  payload: 220,
  error: 200,
  progress: 80,
  attempts: 92,
  created: 120,
};

const DEFAULT_VISIBLE: Record<ColKey, boolean> = {
  id: true,
  name: true,
  payload: true,
  error: true,
  progress: true,
  attempts: true,
  created: true,
};

const COL_LABEL: Record<ColKey, string> = {
  id: 'ID',
  name: 'Name',
  payload: 'Payload',
  error: 'Error',
  progress: 'Progress',
  attempts: 'Attempts',
  created: 'Created',
};

function readWidths(): Record<ColKey, number> {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_WIDTHS };
  }
  try {
    const raw = window.localStorage.getItem(COL_WIDTHS_KEY);
    if (!raw) {
      return { ...DEFAULT_WIDTHS };
    }
    const parsed = JSON.parse(raw) as Partial<Record<ColKey, number>>;
    const next = { ...DEFAULT_WIDTHS };
    for (const key of Object.keys(DEFAULT_WIDTHS) as ColKey[]) {
      const v = parsed[key];
      if (typeof v === 'number' && v >= 48 && v <= 640) {
        next[key] = v;
      }
    }
    return next;
  } catch {
    return { ...DEFAULT_WIDTHS };
  }
}

function readVisible(): Record<ColKey, boolean> {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_VISIBLE };
  }
  try {
    const raw = window.localStorage.getItem(COL_VISIBLE_KEY);
    if (!raw) {
      return { ...DEFAULT_VISIBLE };
    }
    const parsed = JSON.parse(raw) as Partial<Record<ColKey, boolean>>;
    return { ...DEFAULT_VISIBLE, ...parsed };
  } catch {
    return { ...DEFAULT_VISIBLE };
  }
}

function jobErrorText(job: JobRow): string {
  const reason = job.failedReason?.trim();
  if (reason) {
    return reason;
  }
  return job.stacktrace?.[0]?.trim() ?? '';
}

function progressSortValue(progress: unknown): number {
  if (typeof progress === 'number' && Number.isFinite(progress)) {
    return progress;
  }
  if (typeof progress === 'string') {
    const n = Number.parseFloat(progress);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function attemptsMax(job: JobRow): number {
  const a = job.opts['attempts'];
  return typeof a === 'number' && Number.isFinite(a) ? a : Number.NaN;
}

function statusTitle(status: JobStatus): string {
  return OVERVIEW_STATE_ORDER.find((entry) => entry.status === status)?.title ?? status;
}

function resolveJobQueue(job: JobRow, listQueueName: string): string | null {
  if (job.queueName != null && job.queueName !== '') {
    return job.queueName;
  }
  if (listQueueName !== ALL_QUEUES_SENTINEL) {
    return listQueueName;
  }
  return null;
}

function compareJobs(a: JobRow, b: JobRow, key: SortKey, dir: SortDir): number {
  const mul = dir === 'asc' ? 1 : -1;
  switch (key) {
    case 'id':
      return mul * String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
    case 'name':
      return mul * a.name.localeCompare(b.name);
    case 'created':
      return mul * (a.timestamp - b.timestamp);
    case 'progress':
      return mul * (progressSortValue(a.progress) - progressSortValue(b.progress));
    case 'attempts': {
      const maxA = attemptsMax(a);
      const maxB = attemptsMax(b);
      const sa = Number.isFinite(maxA) ? a.attemptsMade / maxA : a.attemptsMade;
      const sb = Number.isFinite(maxB) ? b.attemptsMade / maxB : b.attemptsMade;
      if (sa !== sb) {
        return mul * (sa - sb);
      }
      return mul * (a.attemptsMade - b.attemptsMade);
    }
    case 'payload':
      return mul * jsonToTableCellString(a.data).localeCompare(jsonToTableCellString(b.data));
    case 'error':
      return mul * jobErrorText(a).localeCompare(jobErrorText(b));
    default:
      return 0;
  }
}

export function QueueJobsTable({
  allJobsInSlice,
  jobs,
  totalLoaded,
  pageOffset,
  pageSize,
  canPageBack,
  canPageForward,
  onPageBack,
  onPageForward,
  loading,
  onSelectJob,
  fillHeight,
  queueName,
  jobStatus,
  highlightJobKey,
  onPromoteJob,
  onDuplicateJob,
  onJobsMutated,
}: {
  /** Full API slice (heatmap); `jobs` is already search/filter narrowed. */
  allJobsInSlice: JobRow[];
  jobs: JobRow[];
  totalLoaded: number;
  pageOffset: number;
  pageSize: number;
  canPageBack: boolean;
  canPageForward: boolean;
  onPageBack: () => void;
  onPageForward: () => void;
  loading: boolean;
  onSelectJob: (job: JobRow) => void;
  fillHeight?: boolean;
  queueName: string;
  jobStatus: JobsQueryStatus;
  highlightJobKey: string | null;
  onPromoteJob: (queueName: string, jobId: string) => void | Promise<void>;
  onDuplicateJob: (job: JobRow) => void;
  onJobsMutated: () => void;
}) {
  const crossQueueList = queueName === ALL_QUEUES_SENTINEL;
  const showStatusColumn = jobStatus === 'all';
  const showQueueColumn = crossQueueList;
  const showFailureColumn = jobStatus === 'failed';

  const rowKey = useCallback(
    (job: JobRow) =>
      crossQueueList && job.queueName ? `${job.queueName}:${job.id}` : job.id,
    [crossQueueList],
  );

  const [timeframeBrush, setTimeframeBrush] = useState<TimeframeBrush | null>(null);
  const [heatmapResetKey, setHeatmapResetKey] = useState(0);
  const [plotNow, setPlotNow] = useState(() => Date.now());
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());
  const [removeJobsDialog, setRemoveJobsDialog] = useState<
    null | { kind: 'bulk'; jobs: JobRow[] } | { kind: 'single'; job: JobRow }
  >(null);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [removeJobsInProgress, setRemoveJobsInProgress] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey>('created');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const [colWidths, setColWidths] = useState<Record<ColKey, number>>(readWidths);
  const [visibleCols, setVisibleCols] = useState<Record<ColKey, boolean>>(readVisible);

  const resizeRef = useRef<{
    col: ColKey;
    startX: number;
    startWidth: number;
  } | null>(null);

  useEffect(() => {
    window.localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(colWidths));
  }, [colWidths]);

  useEffect(() => {
    window.localStorage.setItem(COL_VISIBLE_KEY, JSON.stringify(visibleCols));
  }, [visibleCols]);

  useEffect(() => {
    setTimeframeBrush(null);
    setHeatmapResetKey((key) => key + 1);
  }, [queueName, jobStatus, pageOffset]);

  useEffect(() => {
    if (jobStatus !== 'active' && jobStatus !== 'all') {
      return undefined;
    }
    const intervalId = window.setInterval(() => setPlotNow(Date.now()), 10_000);
    return () => window.clearInterval(intervalId);
  }, [jobStatus]);

  useEffect(() => {
    setPlotNow(Date.now());
  }, [jobs, jobStatus]);

  const clearTimeframeBrush = useCallback(() => {
    setTimeframeBrush(null);
    setHeatmapResetKey((key) => key + 1);
  }, []);

  const displayJobs = useMemo(() => {
    if (!timeframeBrush) {
      return jobs;
    }
    return jobs.filter((jobRow) =>
      jobMatchesTimeframeBrush(jobRow, jobStatus, plotNow, timeframeBrush),
    );
  }, [jobs, jobStatus, plotNow, timeframeBrush]);

  useEffect(() => {
    const onMove = (event: globalThis.MouseEvent) => {
      const drag = resizeRef.current;
      if (!drag) {
        return;
      }
      const delta = event.clientX - drag.startX;
      const nextW = Math.min(640, Math.max(48, drag.startWidth + delta));
      setColWidths((previous) => ({ ...previous, [drag.col]: nextW }));
    };
    const onUp = () => {
      resizeRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const sortedJobs = useMemo(() => {
    const copy = [...displayJobs];
    copy.sort((a, b) => compareJobs(a, b, sortKey, sortDir));
    return copy;
  }, [displayJobs, sortKey, sortDir]);

  const toggleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((direction) => (direction === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir(
          key === 'name' || key === 'payload' || key === 'error' ? 'asc' : 'desc',
        );
      }
    },
    [sortKey],
  );

  const showsSearchFilteredHint = totalLoaded > 0 && jobs.length !== totalLoaded;

  const tableColumnCount = useMemo(() => {
    let count = 1;
    if (showQueueColumn) {
      count++;
    }
    if (showStatusColumn) {
      count++;
    }
    if (visibleCols.id) {
      count++;
    }
    if (visibleCols.name) {
      count++;
    }
    if (visibleCols.payload) {
      count++;
    }
    if (showFailureColumn && visibleCols.error) {
      count++;
    }
    if (visibleCols.progress) {
      count++;
    }
    if (visibleCols.attempts) {
      count++;
    }
    if (visibleCols.created) {
      count++;
    }
    count++;
    return count;
  }, [visibleCols, showFailureColumn, showQueueColumn, showStatusColumn]);

  useEffect(() => {
    setSelectedRowKeys(new Set());
  }, [queueName, jobStatus, pageOffset]);

  useEffect(() => {
    if (jobStatus !== 'failed' && sortKey === 'error') {
      setSortKey('created');
      setSortDir('desc');
    }
  }, [jobStatus, sortKey]);

  useEffect(() => {
    const allowed = new Set(displayJobs.map((jobRow) => rowKey(jobRow)));
    setSelectedRowKeys((previous) => {
      let changed = false;
      const next = new Set<string>();
      for (const key of previous) {
        if (allowed.has(key)) {
          next.add(key);
        } else {
          changed = true;
        }
      }
      if (!changed && next.size === previous.size) {
        return previous;
      }
      return next;
    });
  }, [displayJobs, rowKey]);

  const allVisibleSelected =
    displayJobs.length > 0 &&
    displayJobs.every((jobRow) => selectedRowKeys.has(rowKey(jobRow)));
  const someVisibleSelected = displayJobs.some((jobRow) => selectedRowKeys.has(rowKey(jobRow)));
  const headerCheckboxChecked: boolean | 'indeterminate' = allVisibleSelected
    ? true
    : someVisibleSelected
      ? 'indeterminate'
      : false;

  const toggleJobSelected = useCallback((key: string, nextChecked: boolean) => {
    setSelectedRowKeys((previous) => {
      const next = new Set(previous);
      if (nextChecked) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }, []);

  const handleHeaderSelectAll = useCallback(
    (checked: boolean | 'indeterminate') => {
      if (checked === true) {
        setSelectedRowKeys(new Set(displayJobs.map((jobRow) => rowKey(jobRow))));
      } else {
        setSelectedRowKeys(new Set());
      }
    },
    [displayJobs, rowKey],
  );

  const clearBulkSelection = useCallback(() => {
    setSelectedRowKeys(new Set());
  }, []);

  const runBulkJobAction = useCallback(
    async (
      targets: JobRow[],
      label: string,
      action: (job: JobRow) => Promise<void>,
    ) => {
      if (targets.length === 0) {
        return;
      }
      let successCount = 0;
      const failures: string[] = [];
      for (const job of targets) {
        try {
          await action(job);
          successCount += 1;
        } catch (errorUnknown) {
          const message =
            errorUnknown instanceof Error ? errorUnknown.message : String(errorUnknown);
          failures.push(`${rowKey(job)}: ${message}`);
        }
      }
      if (successCount > 0) {
        toast.success(`${label}: ${successCount} job(s) OK.`);
      }
      if (failures.length > 0) {
        toast.error(`${failures.length} failed — ${failures.slice(0, 3).join(' · ')}`);
      }
      onJobsMutated();
      setSelectedRowKeys(new Set());
    },
    [onJobsMutated, rowKey],
  );

  const handleBulkDelete = useCallback(() => {
    const jobs = displayJobs.filter((j) => selectedRowKeys.has(rowKey(j)));
    if (jobs.length === 0) {
      return;
    }
    setRemoveJobsDialog({ kind: 'bulk', jobs });
  }, [displayJobs, rowKey, selectedRowKeys]);

  const confirmRemoveJobs = useCallback(async () => {
    if (removeJobsDialog === null) {
      return;
    }
    setRemoveJobsInProgress(true);
    try {
      if (removeJobsDialog.kind === 'bulk') {
        await runBulkJobAction(removeJobsDialog.jobs, 'Delete', async (job) => {
          const q = resolveJobQueue(job, queueName);
          if (!q) {
            throw new Error('Missing queue for job.');
          }
          await removeQueueJob(q, job.id);
        });
      } else {
        try {
          const job = removeJobsDialog.job;
          const q = resolveJobQueue(job, queueName);
          if (!q) {
            throw new Error('Missing queue for job.');
          }
          await removeQueueJob(q, job.id);
          toast.success('Job removed.');
          setSelectedRowKeys((previous) => {
            const next = new Set(previous);
            next.delete(rowKey(job));
            return next;
          });
          onJobsMutated();
        } catch (errorUnknown) {
          toast.error(errorUnknown instanceof Error ? errorUnknown.message : 'Remove failed.');
        }
      }
    } finally {
      setRemoveJobsInProgress(false);
      setRemoveJobsDialog(null);
    }
  }, [onJobsMutated, queueName, removeJobsDialog, runBulkJobAction, rowKey]);

  const handleBulkRetry = useCallback(() => {
    const selectedJobs = displayJobs.filter((j) => selectedRowKeys.has(rowKey(j)));
    const targets = selectedJobs.filter((j) =>
      jobStatus === 'failed'
        ? true
        : jobStatus === 'all' && (j.state === 'failed' || Boolean(j.failedReason?.trim())),
    );
    if (targets.length === 0) {
      return;
    }
    void runBulkJobAction(targets, 'Retry', async (job) => {
      const q = resolveJobQueue(job, queueName);
      if (!q) {
        throw new Error('Missing queue for job.');
      }
      await retryQueueJob(q, job.id);
    });
  }, [displayJobs, jobStatus, queueName, rowKey, runBulkJobAction, selectedRowKeys]);

  const handleRetryAllVisible = useCallback(() => {
    if (jobStatus !== 'failed' || sortedJobs.length === 0) {
      return;
    }
    void runBulkJobAction(sortedJobs, 'Retry all (visible)', async (job) => {
      const q = resolveJobQueue(job, queueName);
      if (!q) {
        throw new Error('Missing queue for job.');
      }
      await retryQueueJob(q, job.id);
    });
  }, [jobStatus, sortedJobs, queueName, runBulkJobAction]);

  const handleClearAllVisible = useCallback(() => {
    if (sortedJobs.length === 0) {
      return;
    }
    setClearAllOpen(true);
  }, [sortedJobs.length]);

  const confirmClearAllVisible = useCallback(async () => {
    setClearAllOpen(false);
    await runBulkJobAction(sortedJobs, 'Delete all (visible)', async (job) => {
      const q = resolveJobQueue(job, queueName);
      if (!q) {
        throw new Error('Missing queue for job.');
      }
      await removeQueueJob(q, job.id);
    });
  }, [sortedJobs, queueName, runBulkJobAction]);

  const handleBulkPromote = useCallback(() => {
    const selectedJobs = displayJobs.filter((j) => selectedRowKeys.has(rowKey(j)));
    const targets = selectedJobs.filter((j) =>
      jobStatus === 'delayed' ? true : jobStatus === 'all' && j.state === 'delayed',
    );
    if (targets.length === 0) {
      return;
    }
    void runBulkJobAction(targets, 'Promote', async (job) => {
      const q = resolveJobQueue(job, queueName);
      if (!q) {
        throw new Error('Missing queue for job.');
      }
      await onPromoteJob(q, job.id);
    });
  }, [displayJobs, jobStatus, onPromoteJob, queueName, rowKey, runBulkJobAction, selectedRowKeys]);

  const handleRemoveOne = useCallback((job: JobRow) => {
    setRemoveJobsDialog({ kind: 'single', job });
  }, []);

  const handleRetryOne = useCallback(
    async (job: JobRow) => {
      const q = resolveJobQueue(job, queueName);
      if (!q) {
        toast.error('Missing queue for job.');
        return;
      }
      try {
        await retryQueueJob(q, job.id);
        toast.success('Job scheduled for retry.');
        onJobsMutated();
      } catch (errorUnknown) {
        toast.error(errorUnknown instanceof Error ? errorUnknown.message : 'Retry failed.');
      }
    },
    [onJobsMutated, queueName],
  );

  const startResize = useCallback((col: ColKey, event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = {
      col,
      startX: event.clientX,
      startWidth: colWidths[col],
    };
  }, [colWidths]);

  const SortHead = useCallback(
    ({
      colKey,
      label,
      width,
      className,
    }: {
      colKey: SortKey;
      label: string;
      width: number;
      className?: string;
    }) => {
      const active = sortKey === colKey;
      return (
        <th
          style={{ width }}
          className={cn('relative px-2 py-2 font-medium select-none', className)}
        >
          <button
            type="button"
            className={cn(
              'flex w-full items-center gap-1 text-left text-[10px] uppercase tracking-wide text-muted-foreground',
              'hover:text-foreground',
            )}
            onClick={() => toggleSort(colKey)}
          >
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {active ? (
              sortDir === 'asc' ? (
                <ArrowUp className="h-3 w-3 shrink-0 opacity-90" aria-hidden />
              ) : (
                <ArrowDown className="h-3 w-3 shrink-0 opacity-90" aria-hidden />
              )
            ) : (
              <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40" aria-hidden />
            )}
          </button>
          <div
            role="separator"
            aria-hidden
            className="absolute right-0 top-0 z-[2] h-full w-1 cursor-col-resize hover:bg-primary/25"
            onMouseDown={(event) => startResize(colKey as ColKey, event)}
          />
        </th>
      );
    },
    [sortDir, sortKey, startResize, toggleSort],
  );

  const renderPayloadCell = (job: JobRow) => {
    const full = jsonToTableCellString(job.data);
    const cell = (
      <code className="block truncate font-mono text-[10px] leading-tight text-muted-foreground">
        {full}
      </code>
    );
    return (
      <Tooltip delayDuration={400}>
        <TooltipTrigger asChild>
          <div className="min-w-0 cursor-default">{cell}</div>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          className="max-h-[min(70vh,24rem)] max-w-[min(90vw,36rem)] overflow-auto whitespace-pre-wrap break-all border bg-popover p-3 font-mono text-[10px] leading-relaxed text-popover-foreground shadow-md"
        >
          {full || '—'}
        </TooltipContent>
      </Tooltip>
    );
  };

  const renderErrorCell = (job: JobRow) => {
    const full = [job.failedReason?.trim(), job.stacktrace?.join('\n')].filter(Boolean).join('\n\n');
    const short = job.failedReason?.trim()
      ? job.failedReason.trim()
      : job.stacktrace?.[0]?.trim() || '—';
    return (
      <Tooltip delayDuration={400}>
        <TooltipTrigger asChild>
          <p className="line-clamp-2 min-w-0 cursor-default break-words text-left font-mono text-[10px] leading-snug text-destructive">
            {short}
          </p>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          className="max-h-[min(70vh,24rem)] max-w-[min(90vw,36rem)] overflow-auto whitespace-pre-wrap break-all border bg-popover p-3 font-mono text-[10px] leading-relaxed text-popover-foreground shadow-md"
        >
          {full || '—'}
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <div className={cn('flex flex-col gap-1.5', fillHeight && 'min-h-0 flex-1')}>
      <QueueJobsTimeframeHeatmap
        jobs={allJobsInSlice}
        jobStatus={jobStatus}
        brush={timeframeBrush}
        onBrushChange={setTimeframeBrush}
        onClearBrush={clearTimeframeBrush}
        resetKey={heatmapResetKey}
      />
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>
          {loading ? (
            'Loading jobs…'
          ) : (
            <>
              <strong className="font-mono text-foreground">{sortedJobs.length}</strong> shown
              {totalLoaded > 0 && (
                <>
                  {' '}
                  ·{' '}
                  <strong className="font-mono text-foreground">{totalLoaded}</strong> in slice (
                  {pageSize}/request)
                  {totalLoaded > 0 && (
                    <>
                      {' '}
                      · Bull index{' '}
                      <strong className="font-mono text-foreground">
                        {pageOffset}
                        –
                        {pageOffset + totalLoaded - 1}
                      </strong>
                    </>
                  )}
                </>
              )}
              {showsSearchFilteredHint ? (
                <span className="ml-1 text-muted-foreground">· Search / filter</span>
              ) : null}
              {timeframeBrush ? (
                <span className="ml-1 text-muted-foreground">· Time window</span>
              ) : null}
            </>
          )}
        </span>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 px-2 text-[10px]"
                    aria-label="Table columns"
                  >
                    <Columns3 className="h-3.5 w-3.5" aria-hidden />
                    Columns
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="top">Show or hide columns</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="z-[90] w-48" onCloseAutoFocus={(e) => e.preventDefault()}>
              <DropdownMenuLabel className="text-xs">Visible columns</DropdownMenuLabel>
              {(Object.keys(COL_LABEL) as ColKey[]).map((key) => (
                <DropdownMenuCheckboxItem
                  key={key}
                  className="text-xs"
                  checked={visibleCols[key]}
                  disabled={key === 'error' && !showFailureColumn}
                  onCheckedChange={(checked) =>
                    setVisibleCols((previous) => ({ ...previous, [key]: checked === true }))
                  }
                  onSelect={(event) => event.preventDefault()}
                >
                  {COL_LABEL[key]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {jobStatus === 'failed' && sortedJobs.length > 0 && !loading ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 gap-1 px-2 text-[10px]"
              onClick={() => void handleRetryAllVisible()}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Retry all
            </Button>
          ) : null}
          {sortedJobs.length > 0 && !loading ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1 px-2 text-[10px] text-destructive hover:bg-destructive/10"
              onClick={() => void handleClearAllVisible()}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Clear all
            </Button>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1 px-2 text-[10px]"
                disabled={loading || !canPageBack}
                onClick={onPageBack}
                aria-label={`Load previous ${pageSize} jobs (lower Bull index)`}
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                Previous {pageSize}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[14rem] leading-snug">
              Older slice by Bull list index (previous {pageSize} jobs in this state).
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1 px-2 text-[10px]"
                disabled={loading || !canPageForward}
                onClick={onPageForward}
                aria-label={`Load next ${pageSize} jobs (higher Bull index)`}
              >
                Next {pageSize}
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[14rem] leading-snug">
              Next slice by Bull list index (only enabled when the current page is full).
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      {selectedRowKeys.size > 0 && !loading ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-border bg-muted/25 px-2 py-2 text-[11px]">
          <span className="font-medium text-foreground">
            {selectedRowKeys.size} selected
          </span>
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={clearBulkSelection}>
            Clear
          </Button>
          {jobStatus === 'failed' || jobStatus === 'all' ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 gap-1 px-2 text-xs"
              disabled={
                jobStatus === 'all' &&
                !displayJobs.some(
                  (j) =>
                    selectedRowKeys.has(rowKey(j)) &&
                    (j.state === 'failed' || Boolean(j.failedReason?.trim())),
                )
              }
              onClick={() => void handleBulkRetry()}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Retry
            </Button>
          ) : null}
          {jobStatus === 'delayed' || jobStatus === 'all' ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 gap-1 px-2 text-xs"
              disabled={
                jobStatus === 'all' &&
                !displayJobs.some(
                  (j) => selectedRowKeys.has(rowKey(j)) && j.state === 'delayed',
                )
              }
              onClick={() => void handleBulkPromote()}
            >
              <Zap className="h-3.5 w-3.5" aria-hidden />
              Promote
            </Button>
          ) : null}
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-8 gap-1 px-2 text-xs"
            onClick={() => void handleBulkDelete()}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Delete
          </Button>
        </div>
      ) : null}
      <div
        className={cn(
          'touch-pan-x overflow-auto rounded-md border border-border [-webkit-overflow-scrolling:touch]',
          fillHeight ? 'min-h-0 flex-1' : 'max-h-[min(520px,calc(100vh-20rem))]',
        )}
      >
        <table
          className="w-full border-collapse text-[11px]"
          style={{
            tableLayout: 'fixed',
            minWidth: `${52 + (showQueueColumn ? 8 : 0) + (showStatusColumn ? 7 : 0) + (showFailureColumn ? 6 : 0)}rem`,
          }}
        >
          <thead className="sticky top-0 z-[1] bg-muted/90 backdrop-blur">
            <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="w-9 px-1 py-2 text-center font-medium">
                <Checkbox
                  checked={headerCheckboxChecked}
                  onCheckedChange={handleHeaderSelectAll}
                  disabled={loading || displayJobs.length === 0}
                  aria-label="Select all jobs on this page"
                />
              </th>
              {showQueueColumn ? (
                <th className="w-[7.5rem] px-2 py-2 font-medium">Queue</th>
              ) : null}
              {showStatusColumn ? (
                <th className="w-[6.5rem] px-2 py-2 font-medium">Status</th>
              ) : null}
              {visibleCols.id ? (
                <SortHead colKey="id" label="ID" width={colWidths.id} className="max-w-[1%]" />
              ) : null}
              {visibleCols.name ? (
                <SortHead colKey="name" label="Name" width={colWidths.name} />
              ) : null}
              {visibleCols.payload ? (
                <SortHead colKey="payload" label="Payload" width={colWidths.payload} />
              ) : null}
              {showFailureColumn && visibleCols.error ? (
                <SortHead colKey="error" label="Error" width={colWidths.error} />
              ) : null}
              {visibleCols.progress ? (
                <SortHead colKey="progress" label="Progress" width={colWidths.progress} />
              ) : null}
              {visibleCols.attempts ? (
                <SortHead colKey="attempts" label="Attempts" width={colWidths.attempts} />
              ) : null}
              {visibleCols.created ? (
                <SortHead colKey="created" label="Created" width={colWidths.created} />
              ) : null}
              <th className="relative min-w-[10.5rem] whitespace-nowrap px-2 py-2 text-right font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td
                  colSpan={tableColumnCount}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  Loading…
                </td>
              </tr>
            )}
            {!loading &&
              sortedJobs.map((job) => {
                const rk = rowKey(job);
                const rowHighlightKeyForJob =
                  job.queueName != null && job.queueName !== ''
                    ? `${job.queueName}:${job.id}`
                    : `${queueName}:${job.id}`;
                const isHighlighted =
                  highlightJobKey != null && highlightJobKey === rowHighlightKeyForJob;
                const rowState: JobStatus =
                  job.state ??
                  (jobStatus === 'all'
                    ? job.failedReason?.trim()
                      ? 'failed'
                      : 'waiting'
                    : jobStatus);
                const actionQueue = resolveJobQueue(job, queueName);
                const showRetryBtn =
                  jobStatus === 'failed' || (jobStatus === 'all' && rowState === 'failed');
                const showPromoteBtn =
                  jobStatus === 'delayed' || (jobStatus === 'all' && rowState === 'delayed');
                return (
                  <tr
                    key={rk}
                    data-bullseye-job-row={rk}
                    className={cn(
                      'cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted/60',
                      isHighlighted && 'bg-primary/10 ring-1 ring-inset ring-primary/25',
                    )}
                    onClick={() => onSelectJob(job)}
                    onKeyDown={(event: KeyboardEvent) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelectJob(job);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                  >
                    <td
                      className="w-9 px-1 py-1 align-middle"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <div className="flex justify-center pt-0.5">
                        <Checkbox
                          checked={selectedRowKeys.has(rk)}
                          onCheckedChange={(value) => toggleJobSelected(rk, value === true)}
                          aria-label={`Select job ${job.id}`}
                        />
                      </div>
                    </td>
                    {showQueueColumn ? (
                      <td
                        className="truncate px-2 py-1.5 font-mono text-[10px]"
                        title={job.queueName}
                      >
                        {job.queueName ?? '—'}
                      </td>
                    ) : null}
                    {showStatusColumn ? (
                      <td className="px-2 py-1.5">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-[10px] font-medium',
                            JOB_STATE_STYLES[rowState].countBadge,
                          )}
                        >
                          <span
                            className={cn('h-1.5 w-1.5 shrink-0 rounded-full', JOB_STATE_STYLES[rowState].dot)}
                            aria-hidden
                          />
                          {statusTitle(rowState)}
                        </span>
                      </td>
                    ) : null}
                    {visibleCols.id ? (
                      <td
                        className="truncate px-2 py-1.5 font-mono text-[10px] tabular-nums"
                        title={job.id}
                      >
                        {job.id}
                      </td>
                    ) : null}
                    {visibleCols.name ? (
                      <td className="truncate px-2 py-1.5">{job.name}</td>
                    ) : null}
                    {visibleCols.payload ? (
                      <td className="min-w-0 px-2 py-1.5 align-top">{renderPayloadCell(job)}</td>
                    ) : null}
                    {showFailureColumn && visibleCols.error ? (
                      <td className="min-w-0 px-2 py-1.5 align-top">{renderErrorCell(job)}</td>
                    ) : null}
                    {visibleCols.progress ? (
                      <td className="truncate px-2 py-1.5 font-mono text-[10px]">
                        {formatProgressValue(job.progress)}
                      </td>
                    ) : null}
                    {visibleCols.attempts ? (
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[10px]">
                        {job.attemptsMade}/
                        {typeof job.opts['attempts'] === 'number' ? job.opts['attempts'] : '—'}
                      </td>
                    ) : null}
                    {visibleCols.created ? (
                      <td
                        className="whitespace-nowrap px-2 py-1.5 font-mono text-[10px] text-muted-foreground"
                        title={
                          job.timestamp > 0 ? formatTimestampIso(job.timestamp) : undefined
                        }
                      >
                        {formatTimestampPretty(job.timestamp)}
                      </td>
                    ) : null}
                    <td
                      className="px-1 py-1 align-middle text-right"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="flex flex-wrap items-center justify-end gap-0.5">
                        {showRetryBtn && actionQueue ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                aria-label="Retry failed job"
                                onClick={() => void handleRetryOne(job)}
                              >
                                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="left">Retry (re-queue failed job)</TooltipContent>
                          </Tooltip>
                        ) : null}
                        {showPromoteBtn && actionQueue ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                aria-label="Promote job to waiting"
                                onClick={() => void onPromoteJob(actionQueue, job.id)}
                              >
                                <Zap className="h-3.5 w-3.5" aria-hidden />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="left">Promote to waiting (delayed → wait)</TooltipContent>
                          </Tooltip>
                        ) : null}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0"
                              aria-label="Duplicate job"
                              onClick={() => onDuplicateJob(job)}
                            >
                              <CopyPlus className="h-3.5 w-3.5" aria-hidden />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="left">Duplicate with edits…</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              aria-label="Remove job from queue"
                              onClick={() => void handleRemoveOne(job)}
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="left">Delete job from Redis</TooltipContent>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                );
              })}
            {!loading && sortedJobs.length === 0 && (
              <tr>
                <td
                  colSpan={tableColumnCount}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  {totalLoaded === 0
                    ? 'Empty for this state.'
                    : jobs.length === 0
                      ? 'No matches — adjust filters or switch tab.'
                      : timeframeBrush
                        ? 'No jobs in the selected time window — adjust the brush or clear the filter.'
                        : 'No matches — adjust filters or switch tab.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <AlertDialog
        open={removeJobsDialog !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen && !removeJobsInProgress) {
            setRemoveJobsDialog(null);
          }
        }}
      >
        <AlertDialogContent className="gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removeJobsDialog?.kind === 'bulk'
                ? 'Remove selected jobs?'
                : 'Remove job from Redis?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removeJobsDialog?.kind === 'bulk' ? (
                <>
                  This permanently removes{' '}
                  <strong className="text-foreground">{removeJobsDialog.jobs.length}</strong> job(s)
                  from Redis. This cannot be undone.
                </>
              ) : removeJobsDialog?.kind === 'single' ? (
                <>
                  Job{' '}
                  <span className="font-mono text-foreground">{removeJobsDialog.job.id}</span> will be
                  deleted from Redis. This cannot be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeJobsInProgress}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={removeJobsInProgress}
              onClick={() => void confirmRemoveJobs()}
            >
              {removeJobsInProgress ? 'Removing…' : 'Remove'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearAllOpen} onOpenChange={setClearAllOpen}>
        <AlertDialogContent className="gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove all visible jobs?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes{' '}
              <strong className="text-foreground">{sortedJobs.length}</strong> job(s) in the current list
              (search, time window, and sort order) from Redis. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button type="button" variant="destructive" onClick={() => void confirmClearAllVisible()}>
              Remove all
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
