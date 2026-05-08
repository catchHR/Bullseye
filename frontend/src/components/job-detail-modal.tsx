/**
 * Legacy centered dialog for a single queue job. The app now uses `JobDetailDrawer`
 * (right sheet) from `App.tsx`; this module is kept for reference or quick rollback.
 */
import { JobLifecycleTimeline } from '@/components/job-lifecycle-timeline';
import { JobOptsDisplay } from '@/components/job-opts-display';
import { JsonBlock } from '@/components/json-block';
import { StackTraceBlock } from '@/components/stack-trace-block';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fetchJob, type JobRow, type JobStatus } from '@/lib/api';
import { formatProgressValue } from '@/lib/format';
import { JOB_STATE_STYLES } from '@/lib/status-styles';
import { cn } from '@/lib/utils';
import { Copy, CopyPlus } from 'lucide-react';
import { toast } from '@/lib/bullseye-toast';
import { useEffect, useState, type ReactNode } from 'react';

export function JobDetailModal({
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
  /** Opens duplicate flow with this job as template */
  onDuplicate?: (job: JobRow) => void;
}) {
  const [fetchedJob, setFetchedJob] = useState<JobRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payloadOptionsTab, setPayloadOptionsTab] = useState<'payload' | 'options'>('payload');

  const job = fetchedJob ?? initialJob;

  useEffect(() => {
    if (open) {
      setPayloadOptionsTab('payload');
    }
  }, [open, initialJob?.id]);

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

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        className={cn(
          'flex max-h-[92vh] max-w-3xl flex-col gap-0 overflow-hidden rounded-t-xl p-0 pb-[env(safe-area-inset-bottom)] sm:max-h-[min(92vh,880px)] sm:rounded-xl',
        )}
        aria-describedby="job-detail-description"
      >
        <DialogDescription id="job-detail-description" className="sr-only">
          Job details, payload and options in tabs, return value, and error information for this queue job.
        </DialogDescription>
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-3 py-3 pr-12 sm:gap-3 sm:px-4 sm:pr-14">
          <div className="min-w-0 flex-1">
            <DialogTitle
              id="job-detail-title"
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
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 pt-0.5">
            {onDuplicate ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-9 gap-1 px-2 text-xs sm:h-8"
                onClick={() => onDuplicate(job)}
              >
                <CopyPlus className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Duplicate…</span>
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 gap-1 px-2 text-xs sm:h-8"
              onClick={() => void copyFull()}
            >
              <Copy className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Copy JSON</span>
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="border-b border-border/70 pb-3">
            <JobLifecycleTimeline job={job} />
            <div className="mt-3 grid grid-cols-1 gap-3 text-[11px] sm:grid-cols-2">
              <Card className="shadow-sm">
                <div className="p-3">
                  <MetaRow
                    label="Attempts"
                    value={`${job.attemptsMade} / ${
                      typeof job.opts['attempts'] === 'number' ? job.opts['attempts'] : '—'
                    }`}
                  />
                </div>
              </Card>
              <Card className="shadow-sm">
                <div className="p-3">
                  <MetaRow label="Progress" value={formatProgressValue(job.progress)} />
                </div>
              </Card>
            </div>
          </div>

          <div className="mt-4">
            <Tabs value={payloadOptionsTab} onValueChange={(value) => setPayloadOptionsTab(value as 'payload' | 'options')}>
              <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-muted/30 p-1">
                <TabsTrigger value="payload" className="text-xs">
                  Payload · data
                </TabsTrigger>
                <TabsTrigger value="options" className="text-xs">
                  Options · opts
                </TabsTrigger>
              </TabsList>
              <TabsContent value="payload" className="mt-3 outline-none focus-visible:ring-0">
                <JsonBlock value={job.data} emptyLabel="No data" />
              </TabsContent>
              <TabsContent value="options" className="mt-3 outline-none focus-visible:ring-0">
                <JobOptsDisplay opts={job.opts} />
              </TabsContent>
            </Tabs>
          </div>

          <Section title="Return value">
            <JsonBlock value={job.returnvalue} emptyLabel="No result yet" />
          </Section>

          {job.failedReason ? (
            <Section title="Failure reason">
              <pre className="whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 p-3 text-[11px] text-destructive">
                {job.failedReason}
              </pre>
            </Section>
          ) : null}

          {job.stacktrace && job.stacktrace.length > 0 ? (
            <Section title="Stack trace">
              <StackTraceBlock lines={job.stacktrace} />
            </Section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
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
  /** e.g. ISO (UTC) on hover alongside the pretty time */
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}
