import { JsonQuillEditor } from '@/components/json-quill-editor';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createQueueJob, duplicateQueueJob } from '@/lib/api';
import { stripEnqueueMetaFromOpts } from '@/lib/bull-job-opts';
import { toast } from '@/lib/bullseye-toast';
import { cn } from '@/lib/utils';
import { Braces, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

function formatJsonForEditor(value: unknown): string {
  try {
    return `${JSON.stringify(value ?? {}, null, 2)}\n`;
  } catch {
    return '{}\n';
  }
}

export type QueueJobWriteModalMode = 'create' | 'duplicate';

export function QueueJobWriteModal({
  open,
  onOpenChange,
  mode,
  queueName,
  sourceJobId,
  initialJobName,
  initialData,
  initialOpts,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: QueueJobWriteModalMode;
  queueName: string;
  /** Required when `mode === 'duplicate'` */
  sourceJobId?: string;
  initialJobName?: string;
  initialData?: unknown;
  initialOpts?: Record<string, unknown>;
  onSuccess: (newJobId: string) => void;
}) {
  const [jobName, setJobName] = useState('');
  const [dataJson, setDataJson] = useState('{\n}\n');
  const [optsJson, setOptsJson] = useState('{\n}\n');
  const [editorTab, setEditorTab] = useState<'data' | 'opts'>('data');
  const [submitting, setSubmitting] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setJobName(initialJobName ?? '');
    setDataJson(formatJsonForEditor(initialData ?? {}));
    setOptsJson(formatJsonForEditor(stripEnqueueMetaFromOpts(initialOpts ?? {})));
    setEditorTab('data');
    setJsonError(null);
    setSubmitting(false);
  }, [open, initialJobName, initialData, initialOpts]);

  const validateAndParse = useCallback(() => {
    let data: unknown;
    let opts: Record<string, unknown>;
    try {
      data = JSON.parse(dataJson.trim().length === 0 ? '{}' : dataJson) as unknown;
    } catch {
      setJsonError('Payload (data) is not valid JSON.');
      return null;
    }
    try {
      const parsedOpts = JSON.parse(optsJson.trim().length === 0 ? '{}' : optsJson) as unknown;
      if (typeof parsedOpts !== 'object' || parsedOpts === null || Array.isArray(parsedOpts)) {
        setJsonError('Options (opts) must be a JSON object.');
        return null;
      }
      opts = parsedOpts as Record<string, unknown>;
    } catch {
      setJsonError('Options (opts) is not valid JSON.');
      return null;
    }
    setJsonError(null);
    return { data, opts };
  }, [dataJson, optsJson]);

  const handleFormatBoth = useCallback(() => {
    const parsed = validateAndParse();
    if (!parsed) {
      return;
    }
    setDataJson(formatJsonForEditor(parsed.data));
    setOptsJson(formatJsonForEditor(parsed.opts));
    toast.success('Reformatted JSON.');
  }, [validateAndParse]);

  const handleSubmit = useCallback(async () => {
    const parsed = validateAndParse();
    if (!parsed) {
      return;
    }
    setSubmitting(true);
    try {
      const optsForEnqueue = stripEnqueueMetaFromOpts(parsed.opts);
      if (mode === 'create') {
        const result = await createQueueJob(queueName, {
          name: jobName.trim() === '' ? undefined : jobName.trim(),
          data: parsed.data,
          opts: optsForEnqueue,
        });
        toast.success(`Job ${result.id} enqueued.`);
        onSuccess(result.id);
        onOpenChange(false);
        return;
      }
      if (!sourceJobId) {
        toast.error('Missing source job for duplicate.');
        return;
      }
      const result = await duplicateQueueJob(queueName, sourceJobId, {
        name: jobName.trim() === '' ? undefined : jobName.trim(),
        data: parsed.data,
        opts: optsForEnqueue,
      });
      toast.success(`Duplicate job ${result.id} enqueued.`);
      onSuccess(result.id);
      onOpenChange(false);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Request failed.';
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }, [
    mode,
    queueName,
    sourceJobId,
    jobName,
    validateAndParse,
    onSuccess,
    onOpenChange,
  ]);

  const title =
    mode === 'create' ? 'Add job to queue' : 'Duplicate job';
  const description =
    mode === 'create'
      ? 'Define job name, JSON payload (data), and Bull options (opts). Empty name uses Bull default (__default__).'
      : 'Adjust name, data, and opts before enqueueing a copy. jobId and opts.timestamp are removed so Bull can assign a new job id and enqueue time.';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'flex max-h-[min(92vh,900px)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:rounded-xl',
        )}
      >
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 pr-12 sm:px-5 sm:pr-14">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription className="text-left text-xs">{description}</DialogDescription>
          <p className="pt-1 font-mono text-[11px] text-muted-foreground">{queueName}</p>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 sm:px-5">
          <div className="space-y-1.5">
            <Label htmlFor="bullseye-job-name" className="text-xs">
              Job name
            </Label>
            <Input
              id="bullseye-job-name"
              value={jobName}
              onChange={(event) => setJobName(event.target.value)}
              placeholder="__default__ (empty → Bull default)"
              className="font-mono text-xs"
              autoComplete="off"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tabs
              value={editorTab}
              onValueChange={(value) => setEditorTab(value as 'data' | 'opts')}
              className="w-full"
            >
              <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-muted/40 p-1">
                <TabsTrigger value="data" className="text-xs">
                  Payload · data
                </TabsTrigger>
                <TabsTrigger value="opts" className="text-xs">
                  Options · opts
                </TabsTrigger>
              </TabsList>
              <TabsContent value="data" className="mt-2 outline-none">
                <JsonQuillEditor value={dataJson} onChange={setDataJson} />
              </TabsContent>
              <TabsContent value="opts" className="mt-2 outline-none">
                <JsonQuillEditor value={optsJson} onChange={setOptsJson} />
              </TabsContent>
            </Tabs>
          </div>

          {jsonError ? (
            <p className="text-xs text-destructive" role="alert">
              {jsonError}
            </p>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 flex-row flex-wrap gap-2 border-t border-border px-4 py-3 sm:px-5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => handleFormatBoth()}
            disabled={submitting}
          >
            <Braces className="h-3.5 w-3.5" />
            Format JSON
          </Button>
          <div className="flex flex-1 flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void handleSubmit()} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Enqueueing…
                </>
              ) : mode === 'create' ? (
                'Enqueue job'
              ) : (
                'Enqueue duplicate'
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
