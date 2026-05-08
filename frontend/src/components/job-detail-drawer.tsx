import { JobLifecycleTimeline } from '@/components/job-lifecycle-timeline';
import { JobOptsDisplay } from '@/components/job-opts-display';
import { JsonBlock } from '@/components/json-block';
import { StackTraceBlock } from '@/components/stack-trace-block';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogPortal,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { fetchJob, type JobRow, type JobStatus } from '@/lib/api';
import { toast } from '@/lib/bullseye-toast';
import { formatProgressValue } from '@/lib/format';
import { JOB_STATE_STYLES } from '@/lib/status-styles';
import { cn } from '@/lib/utils';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  AlertCircle,
  Braces,
  CheckCircle2,
  Copy,
  CopyPlus,
  ScrollText,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useEffect, useState, type LucideIcon, type ReactNode } from 'react';

type DetailTab = 'payload' | 'options' | 'errors' | 'logs';

function isJobDataEmpty(data: unknown): boolean {
  if (data == null) {
    return true;
  }
  if (typeof data === 'string') {
    return data.trim() === '';
  }
  if (Array.isArray(data)) {
    return data.length === 0;
  }
  if (typeof data === 'object') {
    return Object.keys(data as Record<string, unknown>).length === 0;
  }
  return false;
}

function isReturnValueEmpty(returnvalue: unknown): boolean {
  if (returnvalue == null) {
    return true;
  }
  if (typeof returnvalue === 'string') {
    return returnvalue.trim() === '';
  }
  if (Array.isArray(returnvalue)) {
    return returnvalue.length === 0;
  }
  if (typeof returnvalue === 'object') {
    return Object.keys(returnvalue as Record<string, unknown>).length === 0;
  }
  return false;
}

function isOptsVisuallyEmpty(opts: Record<string, unknown>): boolean {
  return Object.keys(opts).length === 0;
}

function hasErrorContent(job: JobRow): boolean {
  const reason = job.failedReason?.trim();
  if (reason) {
    return true;
  }
  return Boolean(job.stacktrace && job.stacktrace.length > 0);
}

function TabEmptyState({
  icon: Icon,
  title,
  description,
  compact,
  tone = 'neutral',
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Smaller padding when nested inside another tab (e.g. payload sub-blocks). */
  compact?: boolean;
  /** Softer positive styling (e.g. “no errors”). */
  tone?: 'neutral' | 'positive';
}) {
  const tonePositive = tone === 'positive';
  return (
    <div
      className={cn(
        'flex max-w-full min-w-0 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/90 bg-muted/15 text-center',
        compact ? 'px-4 py-8' : 'px-5 py-14',
        tonePositive && 'border-emerald-500/20 bg-emerald-500/[0.06]',
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-2xl shadow-inner',
          tonePositive
            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
            : 'bg-muted/60 text-muted-foreground',
          compact ? 'h-11 w-11' : 'h-14 w-14',
        )}
      >
        <Icon className={compact ? 'h-5 w-5' : 'h-7 w-7'} strokeWidth={1.35} aria-hidden />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mx-auto max-w-[16rem] text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export function JobDetailDrawer({
  open,
  queueName,
  jobStatus,
  initialJob,
  onClose,
  onDuplicate,
}: {
  open: boolean;
  queueName: string;
  jobStatus: JobStatus;
  initialJob: JobRow | null;
  onClose: () => void;
  onDuplicate?: (job: JobRow) => void;
}) {
  const [fetchedJob, setFetchedJob] = useState<JobRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>(() =>
    jobStatus === 'failed' ? 'errors' : 'payload',
  );

  const job = fetchedJob ?? initialJob;

  useEffect(() => {
    if (!open) {
      return;
    }
    setDetailTab(jobStatus === 'failed' ? 'errors' : 'payload');
  }, [open, initialJob?.id, jobStatus]);

  useEffect(() => {
    if (!open || !queueName || !initialJob?.id) {
      return;
    }
    let cancelled = false;
    setFetchedJob(null);
    setError(null);
    setLoading(true);
    void fetchJob(queueName, initialJob.id)
      .then((detail) => {
        if (!cancelled && detail) {
          setFetchedJob(detail);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not refresh job from server.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, queueName, initialJob?.id]);

  if (!open || !job) {
    return null;
  }

  const statusStyle = JOB_STATE_STYLES[jobStatus];

  const fullPayload = () =>
    JSON.stringify(
      {
        id: job.id,
        name: job.name,
        statusView: jobStatus,
        data: job.data,
        opts: job.opts,
        progress: job.progress,
        returnvalue: job.returnvalue,
        failedReason: job.failedReason,
        stacktrace: job.stacktrace,
        timestamp: job.timestamp,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
        attemptsMade: job.attemptsMade,
        logs: job.logs,
        logCount: job.logCount,
      },
      null,
      2,
    );

  const copyFull = async () => {
    try {
      await navigator.clipboard.writeText(fullPayload());
      toast.success('Job JSON copied to clipboard.');
    } catch {
      toast.error('Could not copy to clipboard.');
    }
  };

  const logLines = job.logs ?? [];
  const logTotal =
    typeof job.logCount === 'number' ? job.logCount : logLines.length;

  const dataEmpty = isJobDataEmpty(job.data);
  const returnEmpty = isReturnValueEmpty(job.returnvalue);
  const payloadTabFullyEmpty = dataEmpty && returnEmpty;
  const optionsTabEmpty = isOptsVisuallyEmpty(job.opts);
  const errorsTabEmpty = !hasErrorContent(job);
  const logsTabEmpty = logLines.length === 0;

  return (
    <Dialog open={open} modal={false} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogPortal>
        <DialogPrimitive.Content
          aria-describedby="job-detail-drawer-description"
          onInteractOutside={(event) => event.preventDefault()}
          className={cn(
            'fixed inset-y-0 right-0 z-[70] flex w-full min-w-0 max-w-[min(100vw,26rem)] flex-col overflow-hidden border-l border-border bg-background pb-[env(safe-area-inset-bottom)] shadow-xl sm:max-w-[min(100vw,32rem)]',
            'outline-none duration-300 ease-out will-change-transform',
            'data-[state=closed]:translate-x-full data-[state=open]:translate-x-0',
          )}
        >
          <DialogDescription id="job-detail-drawer-description" className="sr-only">
            Queue job details in tabs: payload, options, errors, and worker log lines. No backdrop —
            the job list stays visible.
          </DialogDescription>

          <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-3 py-3 pr-12 sm:gap-3 sm:px-4 sm:pr-14">
            <div className="min-w-0 flex-1">
              <DialogTitle
                id="job-detail-drawer-title"
                className="truncate font-mono text-sm font-semibold leading-tight"
              >
                Job {job.id}
              </DialogTitle>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                <span className="font-mono">{queueName}</span>
                <span className="opacity-50">·</span>
                <span>{job.name}</span>
                <span className="opacity-50">·</span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md px-1.5 py-px font-medium uppercase',
                    statusStyle.countBadge,
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', statusStyle.dot)} aria-hidden />
                  {jobStatus}
                </span>
                {loading && <span className="ml-1 text-[10px] text-muted-foreground">Refreshing…</span>}
              </p>
              {error && <p className="mt-1 text-[11px] text-muted-foreground">{error}</p>}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-0.5 pt-0.5">
              {onDuplicate ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0 sm:h-8 sm:w-8"
                      aria-label="Duplicate job"
                      onClick={() => onDuplicate(job)}
                    >
                      <CopyPlus className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Duplicate with edits…</TooltipContent>
                </Tooltip>
              ) : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0 sm:h-8 sm:w-8"
                    aria-label="Copy job as JSON"
                    onClick={() => void copyFull()}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Copy full job JSON</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div className="min-w-0 max-w-full shrink-0 overflow-x-auto border-b border-border/80 px-4 py-3">
            <JobLifecycleTimeline job={job} />
            <div className="mt-3 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2">
              <Card className="shadow-sm">
                <div className="p-2.5">
                  <MetaRow
                    label="Attempts"
                    value={`${job.attemptsMade} / ${
                      typeof job.opts['attempts'] === 'number' ? job.opts['attempts'] : '—'
                    }`}
                  />
                </div>
              </Card>
              <Card className="shadow-sm">
                <div className="p-2.5">
                  <MetaRow label="Progress" value={formatProgressValue(job.progress)} />
                </div>
              </Card>
            </div>
          </div>

          <Tabs
            value={detailTab}
            onValueChange={(value) => setDetailTab(value as DetailTab)}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            <div className="min-w-0 max-w-full shrink-0 px-3 pt-2 sm:px-4">
              <TabsList className="grid h-auto w-full grid-cols-4 gap-0.5 bg-muted/40 p-1">
                <TabsTrigger
                  value="payload"
                  className="gap-1 px-1.5 py-2 text-[10px] sm:gap-1.5 sm:px-2 sm:py-1.5 sm:text-xs"
                >
                  <Braces className="h-3.5 w-3.5 shrink-0 opacity-80 sm:h-4 sm:w-4" aria-hidden />
                  <span className="leading-tight">Payload</span>
                </TabsTrigger>
                <TabsTrigger
                  value="options"
                  className="gap-1 px-1.5 py-2 text-[10px] sm:gap-1.5 sm:px-2 sm:py-1.5 sm:text-xs"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 opacity-80 sm:h-4 sm:w-4" aria-hidden />
                  <span className="leading-tight">Options</span>
                </TabsTrigger>
                <TabsTrigger
                  value="errors"
                  className="gap-1 px-1.5 py-2 text-[10px] sm:gap-1.5 sm:px-2 sm:py-1.5 sm:text-xs"
                >
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 opacity-80 sm:h-4 sm:w-4" aria-hidden />
                  <span className="leading-tight">Errors</span>
                </TabsTrigger>
                <TabsTrigger
                  value="logs"
                  className="gap-1 px-1.5 py-2 text-[10px] sm:gap-1.5 sm:px-2 sm:py-1.5 sm:text-xs"
                >
                  <ScrollText className="h-3.5 w-3.5 shrink-0 opacity-80 sm:h-4 sm:w-4" aria-hidden />
                  <span className="leading-tight">Logs</span>
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="min-h-0 min-w-0 flex-1 overflow-auto [-webkit-overflow-scrolling:touch]">
              <div className="min-w-0 max-w-full px-4 py-3">
                <TabsContent
                  value="payload"
                  className="mt-0 min-w-0 max-w-full outline-none focus-visible:ring-0"
                >
                  {payloadTabFullyEmpty ? (
                    <TabEmptyState
                      icon={Braces}
                      title="No payload yet"
                      description="This job has no input data and no return value. They appear here once the job carries data or finishes with a result."
                    />
                  ) : (
                    <div className="min-w-0 max-w-full space-y-6">
                      <div className="min-w-0 max-w-full">
                        <TabBlockTitle>Input data</TabBlockTitle>
                        {dataEmpty ? (
                          <TabEmptyState
                            compact
                            icon={Braces}
                            title="No input data"
                            description="The job was enqueued without a data payload (or it is empty)."
                          />
                        ) : (
                          <JsonBlock value={job.data} emptyLabel="No data" />
                        )}
                      </div>
                      <div className="min-w-0 max-w-full">
                        <TabBlockTitle>Return value</TabBlockTitle>
                        {returnEmpty ? (
                          <TabEmptyState
                            compact
                            icon={Braces}
                            title="No return value"
                            description="No result yet — completed jobs and some processors write a return value here."
                          />
                        ) : (
                          <JsonBlock value={job.returnvalue} emptyLabel="No result yet" />
                        )}
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent
                  value="options"
                  className="mt-0 min-w-0 max-w-full outline-none focus-visible:ring-0"
                >
                  {optionsTabEmpty ? (
                    <TabEmptyState
                      icon={SlidersHorizontal}
                      title="No Bull options"
                      description="The stored opts object is empty. Queues often still apply default job options from the queue."
                    />
                  ) : (
                    <div className="min-w-0 max-w-full overflow-x-auto">
                      <JobOptsDisplay opts={job.opts} />
                    </div>
                  )}
                </TabsContent>

                <TabsContent
                  value="errors"
                  className="mt-0 min-w-0 max-w-full outline-none focus-visible:ring-0"
                >
                  {errorsTabEmpty ? (
                    <TabEmptyState
                      tone="positive"
                      icon={CheckCircle2}
                      title="No errors recorded"
                      description="No failure reason or stack trace on this job row — it has not failed in a way Bull persisted here."
                    />
                  ) : (
                    <div className="min-w-0 max-w-full space-y-4">
                      {job.failedReason?.trim() ? (
                        <div className="min-w-0 max-w-full">
                          <TabBlockTitle>Failure reason</TabBlockTitle>
                          <pre className="max-w-full min-w-0 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-destructive/35 bg-destructive/5 p-3 text-[11px] text-destructive">
                            {job.failedReason}
                          </pre>
                        </div>
                      ) : null}
                      {job.stacktrace && job.stacktrace.length > 0 ? (
                        <div className="min-w-0 max-w-full">
                          <TabBlockTitle>Stack trace</TabBlockTitle>
                          <StackTraceBlock lines={job.stacktrace} />
                        </div>
                      ) : null}
                    </div>
                  )}
                </TabsContent>

                <TabsContent
                  value="logs"
                  className="mt-0 min-w-0 max-w-full outline-none focus-visible:ring-0"
                >
                  {logsTabEmpty ? (
                    <TabEmptyState
                      icon={ScrollText}
                      title="No queue log lines"
                      description="Workers can append lines with Bull’s job.log(). Nothing is stored for this job yet."
                    />
                  ) : (
                    <div className="min-w-0 max-w-full">
                      <p className="mb-2 max-w-full text-[10px] text-muted-foreground">
                        Lines from <code className="rounded bg-muted px-1 py-px font-mono">job.log()</code>
                        {' · '}
                        showing <span className="font-mono text-foreground">{logLines.length}</span> of{' '}
                        <span className="font-mono text-foreground">{logTotal}</span>
                      </p>
                      <pre className="max-h-[min(50vh,22rem)] max-w-full min-w-0 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/30 p-3 font-mono text-[10px] leading-relaxed text-foreground">
                        {logLines.join('\n')}
                      </pre>
                    </div>
                  )}
                </TabsContent>
              </div>
            </div>
          </Tabs>

          <DialogClose className="absolute right-3 top-3 rounded-md p-2 text-muted-foreground opacity-80 ring-offset-background transition-opacity hover:bg-muted hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
            <X className="h-4 w-4" aria-hidden />
            <span className="sr-only">Close</span>
          </DialogClose>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

function TabBlockTitle({ children }: { children: ReactNode }) {
  return (
    <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h4>
  );
}

function MetaRow({
  label,
  value,
  detailTitle,
  className,
}: {
  label: string;
  value: string;
  detailTitle?: string;
  className?: string;
}) {
  return (
    <div className={cn('grid min-w-0 gap-0.5 leading-snug', className)}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className="cursor-default break-words font-mono text-[11px] text-foreground"
        title={detailTitle || undefined}
      >
        {value}
      </p>
    </div>
  );
}
