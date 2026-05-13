import { AlertPayloadEditor, pathToJsExpression } from '@/components/alert-payload-editor';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MultiSelect } from '@/components/multi-select';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  createAlert,
  deleteAlert,
  fetchAlerts,
  fetchSuggestedAlertJobNames,
  type AlertDefinition,
  type AlertTrigger,
  type AlertTriggerType,
  updateAlert,
  type QueueSummary,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { Bell, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { toast } from '@/lib/bullseye-toast';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const TRIGGER_LABELS: Record<AlertTriggerType, string> = {
  job_failed: 'Job failed',
  queue_error: 'Queue error',
  job_stalled: 'Job stalled',
  job_completed: 'Job completed',
};

/** Discord webhook: JavaScript expression using `ctx` → JSON body */
export const DISCORD_JOB_FAILED_JS = `({
  embeds: [{
    title: 'Job failed: ' + (ctx.job?.name ?? ''),
    description: (ctx.job?.failedReason ?? '').slice(0, 4000),
    color: 15158332,
    fields: [
      { name: 'Queue', value: ctx.queueName, inline: true },
      { name: 'Job id', value: ctx.job?.id ?? '', inline: true },
      { name: 'Attempts', value: String(ctx.job?.attemptsMade ?? 0), inline: true },
    ],
    footer: { text: ctx.trigger },
  }],
})`;

function newTrigger(): AlertTrigger {
  return {
    id:
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `tr_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    type: 'job_failed',
    queueNames: [],
    jobNames: [],
    payloadMode: 'javascript',
    payloadBody: DISCORD_JOB_FAILED_JS,
  };
}

/** Migrate legacy template payloads to JavaScript when opening the editor. */
function normalizeStoredTrigger(trigger: AlertTrigger): AlertTrigger {
  if (trigger.payloadMode === 'javascript') {
    return trigger;
  }
  const migratedBody = trigger.payloadBody.replace(
    /\{\{\s*([\s\S]*?)\s*\}\}/g,
    (_fullMatch, rawInner: string) => {
      const inner = rawInner.trim();
      if (inner.startsWith('js ')) {
        return inner.slice(3).trim();
      }
      return pathToJsExpression(inner);
    },
  );
  return { ...trigger, payloadMode: 'javascript', payloadBody: migratedBody };
}

function setTriggerAggregationNumber(
  trigger: AlertTrigger,
  field: 'aggregationDebounceMs' | 'aggregationLookbackMinutes' | 'aggregationMaxWebhooksPerMinute',
  raw: string,
): AlertTrigger {
  const trimmed = raw.trim();
  if (trimmed === '') {
    const next = { ...trigger };
    delete next[field];
    if (field === 'aggregationDebounceMs') {
      delete next.aggregationLookbackMinutes;
      delete next.aggregationMaxWebhooksPerMinute;
    }
    return next;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    return trigger;
  }
  return { ...trigger, [field]: n };
}

function AlertTriggerEditor({
  queueOptions,
  trigger,
  jobNameOptions,
  onChange,
  mayRemove,
  onRemove,
}: {
  queueOptions: string[];
  trigger: AlertTrigger;
  jobNameOptions: string[];
  onChange: (next: AlertTrigger) => void;
  mayRemove: boolean;
  onRemove: () => void;
}) {
  const jobTriggerTypes: AlertTriggerType[] = [
    'job_failed',
    'job_stalled',
    'job_completed',
  ];
  const showJobNames = jobTriggerTypes.includes(trigger.type);

  /** Match {@link MultiSelect} label line so controls align across columns */
  const filterFieldLabelClass =
    'mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground';

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-12 md:items-start">
        <div className="min-w-0 md:col-span-3">
          <p className={filterFieldLabelClass}>Trigger</p>
          <Select
            value={trigger.type}
            onValueChange={(nextType) =>
              onChange({ ...trigger, type: nextType as AlertTriggerType })
            }
          >
            <SelectTrigger className="h-9 min-h-9 w-full px-2.5 py-1.5 text-xs font-normal">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(TRIGGER_LABELS) as AlertTriggerType[]).map((triggerType) => (
                <SelectItem key={triggerType} value={triggerType} className="text-xs">
                  {TRIGGER_LABELS[triggerType]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 md:col-span-4">
          <MultiSelect
            label="Queues"
            options={queueOptions}
            selected={trigger.queueNames}
            onChange={(queueNames) => onChange({ ...trigger, queueNames })}
            placeholder="All queues"
          />
        </div>
        <div className="min-w-0 md:col-span-4">
          {showJobNames ? (
            <MultiSelect
              label="Job names"
              options={jobNameOptions}
              selected={trigger.jobNames}
              onChange={(jobNames) => onChange({ ...trigger, jobNames })}
              placeholder="All jobs"
            />
          ) : (
            <>
              <p className={filterFieldLabelClass}>Job names</p>
              <div className="flex min-h-9 items-center rounded-md border border-dashed border-muted px-2.5 py-1.5 text-xs text-muted-foreground">
                Job-trigger types only
              </div>
            </>
          )}
        </div>
        {mayRemove ? (
          <div className="flex min-w-0 flex-col items-end md:col-span-1">
            <p className={cn(filterFieldLabelClass, 'w-full')} aria-hidden>
              <span className="select-none text-transparent">Trigger</span>
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-destructive hover:text-destructive"
              onClick={onRemove}
              aria-label="Remove trigger"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="hidden md:col-span-1 md:block" aria-hidden />
        )}
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Payload (JavaScript expression → JSON)
        </Label>
        <AlertPayloadEditor
          key={trigger.id}
          value={trigger.payloadBody}
          onChange={(nextPayloadBody) =>
            onChange({ ...trigger, payloadBody: nextPayloadBody })
          }
        />
      </div>
      <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-2.5">
        <p className={cn(filterFieldLabelClass, 'normal-case tracking-normal')}>
          Webhook aggregation (optional)
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Debounce (ms)</Label>
            <Input
              type="number"
              min={0}
              className="h-9 font-mono text-xs"
              placeholder="Off"
              value={trigger.aggregationDebounceMs ?? ''}
              onChange={(e) =>
                onChange(setTriggerAggregationNumber(trigger, 'aggregationDebounceMs', e.target.value))
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Lookback (min)</Label>
            <Input
              type="number"
              min={1}
              className="h-9 font-mono text-xs"
              placeholder="Default: 5"
              value={trigger.aggregationLookbackMinutes ?? ''}
              onChange={(e) =>
                onChange(
                  setTriggerAggregationNumber(trigger, 'aggregationLookbackMinutes', e.target.value),
                )
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Max webhooks / min</Label>
            <Input
              type="number"
              min={1}
              className="h-9 font-mono text-xs"
              placeholder="Default: 10"
              value={trigger.aggregationMaxWebhooksPerMinute ?? ''}
              onChange={(e) =>
                onChange(
                  setTriggerAggregationNumber(
                    trigger,
                    'aggregationMaxWebhooksPerMinute',
                    e.target.value,
                  ),
                )
              }
            />
          </div>
        </div>
        <p className="text-[10px] leading-snug text-muted-foreground">
          Set debounce to bundle events in Redis; leave empty for one webhook per event (legacy).
        </p>
      </div>
    </div>
  );
}

function AlertDraftEditorFields({
  draftName,
  setDraftName,
  draftEnabled,
  setDraftEnabled,
  draftWebhook,
  setDraftWebhook,
  draftMethod,
  setDraftMethod,
  draftHeadersJson,
  setDraftHeadersJson,
  draftTriggers,
  setDraftTriggers,
  queueNames,
  draftJobNamesByQueues,
  children,
}: {
  draftName: string;
  setDraftName: (name: string) => void;
  draftEnabled: boolean;
  setDraftEnabled: (enabled: boolean) => void;
  draftWebhook: string;
  setDraftWebhook: (url: string) => void;
  draftMethod: 'POST' | 'PUT';
  setDraftMethod: (method: 'POST' | 'PUT') => void;
  draftHeadersJson: string;
  setDraftHeadersJson: (json: string) => void;
  draftTriggers: AlertTrigger[];
  setDraftTriggers: Dispatch<SetStateAction<AlertTrigger[]>>;
  queueNames: string[];
  draftJobNamesByQueues: string[];
  children: ReactNode;
}) {
  const draftFieldLabelClass =
    'text-[10px] font-medium uppercase tracking-wide text-muted-foreground';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[min(100%,240px)] flex-1 space-y-1">
          <Label htmlFor="alert-draft-name" className={draftFieldLabelClass}>
            Name
          </Label>
          <Input
            id="alert-draft-name"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="e.g. Discord failures"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2 pb-2">
          <Switch
            id="alert-draft-enabled"
            checked={draftEnabled}
            onCheckedChange={(checked) => setDraftEnabled(checked === true)}
          />
          <Label htmlFor="alert-draft-enabled" className="cursor-pointer text-sm font-normal">
            Enabled
          </Label>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(5.5rem,auto)_1fr] sm:items-end">
        <div className="space-y-1">
          <Label className={draftFieldLabelClass}>Method</Label>
          <Select
            value={draftMethod}
            onValueChange={(nextMethod) => setDraftMethod(nextMethod as 'POST' | 'PUT')}
          >
            <SelectTrigger className="h-9 min-w-[5.5rem] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="POST" className="text-xs">
                POST
              </SelectItem>
              <SelectItem value="PUT" className="text-xs">
                PUT
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="alert-draft-webhook" className={draftFieldLabelClass}>
            URL
          </Label>
          <Input
            id="alert-draft-webhook"
            value={draftWebhook}
            onChange={(event) => setDraftWebhook(event.target.value)}
            className="font-mono text-xs"
            placeholder="https://…"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="alert-draft-headers" className={draftFieldLabelClass}>
          Extra headers (JSON, optional)
        </Label>
        <Textarea
          id="alert-draft-headers"
          value={draftHeadersJson}
          onChange={(event) => setDraftHeadersJson(event.target.value)}
          rows={2}
          className="min-h-[60px] font-mono text-[11px]"
          placeholder='{"Authorization":"Bearer …"}'
        />
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">Trigger</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-[11px]"
            onClick={() =>
              setDraftTriggers((previous) => [...previous, newTrigger()])
            }
          >
            Add trigger
          </Button>
        </div>
        <div className="divide-y divide-border rounded-lg border border-border bg-muted/10">
          {draftTriggers.map((trigger, triggerIndex) => (
            <div key={trigger.id} className="p-3">
              <AlertTriggerEditor
                queueOptions={queueNames}
                trigger={trigger}
                jobNameOptions={draftJobNamesByQueues}
                mayRemove={draftTriggers.length > 1}
                onRemove={() =>
                  setDraftTriggers((previous) =>
                    previous.filter((_, itemIndex) => itemIndex !== triggerIndex),
                  )
                }
                onChange={(next) =>
                  setDraftTriggers((previous) => {
                    const copy = [...previous];
                    copy[triggerIndex] = next;
                    return copy;
                  })
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">{children}</div>
    </div>
  );
}

export function AlertsPanel({ queues }: { queues: QueueSummary[] }) {
  const queueNames = useMemo(() => queues.map((queue) => queue.name).sort(), [queues]);

  const [alerts, setAlerts] = useState<AlertDefinition[]>([]);
  const [alertsDocumentVersion, setAlertsDocumentVersion] = useState<number | undefined>();
  const editBaseConfigVersionRef = useRef<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [panelError, setPanelError] = useState<string | null>(null);

  /** Alert id with expanded trigger details in the list (chevron open). */
  const [openAlertId, setOpenAlertId] = useState<string | null>(null);
  /** Editor mode: creating new alert or editing existing alert id */
  const [editorMode, setEditorMode] = useState<string | 'new' | null>(null);

  const [draftName, setDraftName] = useState('');
  const [draftEnabled, setDraftEnabled] = useState(true);
  const [draftWebhook, setDraftWebhook] = useState('');
  const [draftMethod, setDraftMethod] = useState<'POST' | 'PUT'>('POST');
  const [draftHeadersJson, setDraftHeadersJson] = useState('');
  const [draftTriggers, setDraftTriggers] = useState<AlertTrigger[]>([newTrigger()]);
  const [draftJobNamesByQueues, setDraftJobNamesByQueues] = useState<string[]>([]);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAlerts();
      setAlerts(data.alerts);
      setAlertsDocumentVersion(data.configVersion);
      setPanelError(null);
    } catch (errorUnknown) {
      const message =
        errorUnknown instanceof Error ? errorUnknown.message : 'Alerts failed';
      setPanelError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts]);

  const selectedQueuesForJobs = useMemo(() => {
    const merged = new Set<string>();
    for (const trigger of draftTriggers) {
      if (trigger.queueNames.length === 0) {
        queueNames.forEach((queueName) => merged.add(queueName));
      } else {
        trigger.queueNames.forEach((queueName) => merged.add(queueName));
      }
    }
    return [...merged].sort();
  }, [draftTriggers, queueNames]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const names = await fetchSuggestedAlertJobNames(selectedQueuesForJobs);
        if (!cancelled) {
          setDraftJobNamesByQueues(names);
        }
      } catch {
        if (!cancelled) {
          setDraftJobNamesByQueues([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedQueuesForJobs]);

  function resetDraftForCreate() {
    setDraftName('');
    setDraftEnabled(true);
    setDraftWebhook('');
    setDraftMethod('POST');
    setDraftHeadersJson('');
    setDraftTriggers([newTrigger()]);
  }

  function beginEdit(alertItem: AlertDefinition) {
    editBaseConfigVersionRef.current = alertsDocumentVersion;
    setEditorMode(alertItem.id);
    setDraftName(alertItem.name);
    setDraftEnabled(alertItem.enabled);
    setDraftWebhook(alertItem.webhookUrl);
    setDraftMethod(alertItem.httpMethod);
    setDraftHeadersJson(
      Object.keys(alertItem.headers).length > 0
        ? JSON.stringify(alertItem.headers, null, 2)
        : '',
    );
    setDraftTriggers(
      alertItem.triggers.map((trigger) =>
        normalizeStoredTrigger({
          ...trigger,
          id: trigger.id || newTrigger().id,
        }),
      ),
    );
  }

  async function saveDraft(editingId: string | 'new') {
    const trimmedName = draftName.trim();
    if (trimmedName === '') {
      toast.error('Please enter an alert name.');
      return;
    }
    const trimmedWebhook = draftWebhook.trim();
    if (trimmedWebhook === '') {
      toast.error('Please enter a webhook URL.');
      return;
    }
    try {
      const parsedUrl = new URL(trimmedWebhook);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        toast.error('Webhook URL must start with http:// or https://.');
        return;
      }
    } catch {
      toast.error('Webhook URL is not valid.');
      return;
    }

    let headers: Record<string, string> = {};
    const trimmedHeaders = draftHeadersJson.trim();
    if (trimmedHeaders !== '') {
      try {
        const parsed: unknown = JSON.parse(trimmedHeaders);
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed)
        ) {
          headers = Object.fromEntries(
            Object.entries(parsed).map(([key, value]) => [
              key,
              typeof value === 'string' ? value : JSON.stringify(value),
            ]),
          );
        }
      } catch {
        const message = 'Headers must be valid JSON.';
        setPanelError(message);
        toast.error(message);
        return;
      }
    }

    const payload: Omit<AlertDefinition, 'id'> & { expectedConfigVersion?: number } = {
      name: trimmedName,
      enabled: draftEnabled,
      webhookUrl: trimmedWebhook,
      httpMethod: draftMethod,
      headers,
      triggers: draftTriggers.map((trigger) => ({
        ...trigger,
        payloadMode: 'javascript',
      })),
    };
    if (editingId !== 'new' && editBaseConfigVersionRef.current !== undefined) {
      payload.expectedConfigVersion = editBaseConfigVersionRef.current;
    }

    try {
      setPanelError(null);
      if (editingId === 'new') {
        await createAlert(payload);
      } else {
        await updateAlert(editingId, payload);
      }
      await loadAlerts();
      setEditorMode(null);
      resetDraftForCreate();
      toast.success(editingId === 'new' ? 'Alert created.' : 'Alert saved.');
    } catch (errorUnknown) {
      if (
        errorUnknown &&
        typeof errorUnknown === 'object' &&
        'status' in errorUnknown &&
        (errorUnknown as { status?: number }).status === 409
      ) {
        toast.error('Alert configuration changed elsewhere. Reloading list.');
        await loadAlerts();
        return;
      }
      const message =
        errorUnknown instanceof Error ? errorUnknown.message : 'Save failed';
      setPanelError(message);
      toast.error(message);
    }
  }

  async function removeAlert(id: string) {
    if (!window.confirm('Delete this alert?')) {
      return;
    }
    try {
      await deleteAlert(id);
      await loadAlerts();
      setEditorMode((current) => (current === id ? null : current));
      toast.success('Alert deleted.');
    } catch (errorUnknown) {
      const message =
        errorUnknown instanceof Error ? errorUnknown.message : 'Delete failed';
      setPanelError(message);
      toast.error(message);
    }
  }

  async function toggleEnabled(alertItem: AlertDefinition, enabled: boolean) {
    try {
      const { id: _id, ...rest } = alertItem;
      void _id;
      await updateAlert(alertItem.id, {
        ...rest,
        enabled,
        ...(alertsDocumentVersion !== undefined
          ? { expectedConfigVersion: alertsDocumentVersion }
          : {}),
      });
      await loadAlerts();
      toast.success(enabled ? 'Alert enabled.' : 'Alert disabled.');
    } catch (errorUnknown) {
      if (
        errorUnknown &&
        typeof errorUnknown === 'object' &&
        'status' in errorUnknown &&
        (errorUnknown as { status?: number }).status === 409
      ) {
        toast.error('Alert configuration changed elsewhere. Reloading list.');
        await loadAlerts();
        return;
      }
      const message =
        errorUnknown instanceof Error ? errorUnknown.message : 'Update failed';
      setPanelError(message);
      toast.error(message);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border shadow-none">
        <CardHeader className="shrink-0 pb-2">
          <div className="flex items-start gap-3">
            <Bell className="mt-0.5 h-5 w-5 text-muted-foreground" strokeWidth={1.75} />
            <div>
              <CardTitle className="text-base">Alerts & Webhooks</CardTitle>
              <CardDescription className="text-xs leading-relaxed">
                When selected Bull events fire, an HTTP request is sent to your URL.
                Context includes <code className="rounded bg-muted px-1">ctx.queueName</code>,{' '}
                <code className="rounded bg-muted px-1">ctx.job</code>,{' '}
                <code className="rounded bg-muted px-1">ctx.trigger</code>, and{' '}
                <code className="rounded bg-muted px-1">ctx.error</code>. Events are emitted on the queue
                instance in the <strong>same Nest process</strong> as this UI (in-process workers).
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden">
          {panelError ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {panelError}
            </p>
          ) : null}

          {loading ? (
            <p className="text-xs text-muted-foreground">Loading alerts…</p>
          ) : (
            <ul className="space-y-2">
              {alerts.map((alertItem) => (
                <li
                  key={alertItem.id}
                  className="rounded-lg border border-border bg-card"
                >
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenAlertId((current) =>
                          current === alertItem.id ? null : alertItem.id,
                        )
                      }
                      className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {openAlertId === alertItem.id ? (
                        <ChevronDown className="h-4 w-4 shrink-0 opacity-70" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 opacity-70" />
                      )}
                      <span className="truncate font-medium">{alertItem.name}</span>
                      {!alertItem.enabled ? (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          disabled
                        </Badge>
                      ) : null}
                    </button>
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`alert-enabled-${alertItem.id}`}
                        checked={alertItem.enabled}
                        onCheckedChange={(checked) =>
                          void toggleEnabled(alertItem, checked === true)
                        }
                      />
                      <Label
                        htmlFor={`alert-enabled-${alertItem.id}`}
                        className="cursor-pointer text-[11px] font-normal text-muted-foreground"
                      >
                        Enabled
                      </Label>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => beginEdit(alertItem)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => void removeAlert(alertItem.id)}
                      aria-label="Delete alert"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {openAlertId !== alertItem.id ? (
                    <ul className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                      {alertItem.triggers.map((trigger) => (
                        <li key={trigger.id}>
                          <span className="font-medium text-foreground">
                            {TRIGGER_LABELS[trigger.type]}
                          </span>
                          {trigger.queueNames.length > 0
                            ? ` · queues: ${trigger.queueNames.join(', ')}`
                            : ' · queues: all'}
                          {['job_failed', 'job_stalled', 'job_completed'].includes(
                            trigger.type,
                          ) && trigger.jobNames.length > 0
                            ? ` · jobs: ${trigger.jobNames.join(', ')}`
                            : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {editorMode !== 'new' ? (
            <div className="rounded-lg border border-dashed border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">New alert</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 text-xs"
                  onClick={() => {
                    resetDraftForCreate();
                    setEditorMode('new');
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create
                </Button>
              </div>
            </div>
          ) : null}

          {editorMode === 'new' ? (
            <Card className="border-foreground/15">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Configure alert</CardTitle>
              </CardHeader>
              <CardContent>
                <AlertDraftEditorFields
                  draftName={draftName}
                  setDraftName={setDraftName}
                  draftEnabled={draftEnabled}
                  setDraftEnabled={setDraftEnabled}
                  draftWebhook={draftWebhook}
                  setDraftWebhook={setDraftWebhook}
                  draftMethod={draftMethod}
                  setDraftMethod={setDraftMethod}
                  draftHeadersJson={draftHeadersJson}
                  setDraftHeadersJson={setDraftHeadersJson}
                  draftTriggers={draftTriggers}
                  setDraftTriggers={setDraftTriggers}
                  queueNames={queueNames}
                  draftJobNamesByQueues={draftJobNamesByQueues}
                >
                  <Button type="button" size="sm" onClick={() => void saveDraft('new')}>
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditorMode(null);
                      resetDraftForCreate();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setDraftTriggers((previous) =>
                        previous.map((trigger, triggerIndex) =>
                          triggerIndex === 0
                            ? {
                                ...trigger,
                                payloadMode: 'javascript',
                                payloadBody: DISCORD_JOB_FAILED_JS,
                              }
                            : trigger,
                        ),
                      )
                    }
                  >
                    Discord template (trigger 1)
                  </Button>
                </AlertDraftEditorFields>
              </CardContent>
            </Card>
          ) : null}

          {editorMode !== null && editorMode !== 'new' ? (
            <Card className="border-foreground/15">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Edit alert</CardTitle>
              </CardHeader>
              <CardContent>
                <AlertDraftEditorFields
                  draftName={draftName}
                  setDraftName={setDraftName}
                  draftEnabled={draftEnabled}
                  setDraftEnabled={setDraftEnabled}
                  draftWebhook={draftWebhook}
                  setDraftWebhook={setDraftWebhook}
                  draftMethod={draftMethod}
                  setDraftMethod={setDraftMethod}
                  draftHeadersJson={draftHeadersJson}
                  setDraftHeadersJson={setDraftHeadersJson}
                  draftTriggers={draftTriggers}
                  setDraftTriggers={setDraftTriggers}
                  queueNames={queueNames}
                  draftJobNamesByQueues={draftJobNamesByQueues}
                >
                  <Button type="button" size="sm" onClick={() => void saveDraft(editorMode)}>
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditorMode(null)}
                  >
                    Cancel
                  </Button>
                </AlertDraftEditorFields>
              </CardContent>
            </Card>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
