/** SPA mount base path (e.g. `/queue-dashboard`), no trailing slash */
function mountBasePath(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  return window.location.pathname.replace(/\/$/, '') || '';
}

export type BullseyeOperatorUi = {
  displayName: string;
  email: string;
  avatarUrl: string | null;
};

export type BullseyeUiConfig = {
  operator: BullseyeOperatorUi;
};

export async function fetchUiConfig(): Promise<BullseyeUiConfig> {
  const response = await fetch(`${mountBasePath()}/api/ui-config`);
  if (!response.ok) {
    throw new Error('UI config failed to load');
  }
  return response.json() as Promise<BullseyeUiConfig>;
}

export async function fetchQueues() {
  const response = await fetch(`${mountBasePath()}/api/queues`);
  if (!response.ok) {
    throw new Error('Queues failed to load');
  }
  return response.json() as Promise<QueueSummary[]>;
}

export type RedisMetrics = {
  ts: number;
  redisVersion: string | null;
  role: string | null;
  uptimeSec: number | null;
  dbKeys: number | null;
  clients: { connected: number | null; blocked: number | null };
  opsPerSec: number | null;
  keyspace: { hits: number | null; misses: number | null; hitRate: number | null };
  memory: {
    usedBytes: number | null;
    peakBytes: number | null;
    rssBytes: number | null;
    maxBytes: number | null;
    fragmentationRatio: number | null;
  };
};

export async function fetchRedisMetrics(): Promise<RedisMetrics> {
  const response = await fetch(`${mountBasePath()}/api/redis/metrics`);
  if (!response.ok) {
    throw new Error('Redis metrics failed to load');
  }
  return response.json() as Promise<RedisMetrics>;
}

export interface RepeatableJob {
  queueName: string;
  key: string;
  name: string;
  id?: string | null;
  cron: string | null;
  every: number | null;
  next: number;
  endDate: number | null;
  tz: string | null;
}

export async function fetchRepeatableJobs() {
  const response = await fetch(`${mountBasePath()}/api/repeatable-jobs`);
  if (!response.ok) {
    throw new Error('Repeatable jobs failed to load');
  }
  return response.json() as Promise<RepeatableJob[]>;
}

export type JobStatus =
  | 'waiting'
  | 'active'
  | 'delayed'
  | 'completed'
  | 'failed'
  | 'paused';

/** Queue jobs API tab / `status` query (includes merged “All states” view). */
export type JobsQueryStatus = JobStatus | 'all';

/** Sentinel: list jobs merged across every queue (matches backend). */
export const ALL_QUEUES_SENTINEL = '__all_queues__';

export async function fetchJob(queueName: string, jobId: string) {
  const response = await fetch(
    `${mountBasePath()}/api/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}`,
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error('Job failed to load');
  }
  return response.json() as Promise<JobRow>;
}

export async function promoteJob(queueName: string, jobId: string): Promise<void> {
  const response = await fetch(
    `${mountBasePath()}/api/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}/promote`,
    { method: 'POST' },
  );
  if (response.status === 404) {
    throw new Error('Job not found.');
  }
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(errorBody.message ?? 'Promote failed.');
  }
}

export async function removeQueueJob(queueName: string, jobId: string): Promise<void> {
  const response = await fetch(
    `${mountBasePath()}/api/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}`,
    { method: 'DELETE' },
  );
  if (response.status === 404) {
    throw new Error('Job not found.');
  }
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(errorBody.message ?? 'Remove job failed.');
  }
}

export async function retryQueueJob(queueName: string, jobId: string): Promise<void> {
  const response = await fetch(
    `${mountBasePath()}/api/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(jobId)}/retry`,
    { method: 'POST' },
  );
  if (response.status === 404) {
    throw new Error('Job not found.');
  }
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(errorBody.message ?? 'Retry failed.');
  }
}

export async function pauseQueue(queueName: string): Promise<void> {
  const response = await fetch(
    `${mountBasePath()}/api/queues/${encodeURIComponent(queueName)}/pause`,
    { method: 'POST' },
  );
  if (response.status === 404) {
    throw new Error('Queue not found.');
  }
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(errorBody.message ?? 'Pause failed.');
  }
}

export async function resumeQueue(queueName: string): Promise<void> {
  const response = await fetch(
    `${mountBasePath()}/api/queues/${encodeURIComponent(queueName)}/resume`,
    { method: 'POST' },
  );
  if (response.status === 404) {
    throw new Error('Queue not found.');
  }
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(errorBody.message ?? 'Resume failed.');
  }
}

export async function emptyQueue(queueName: string): Promise<void> {
  const response = await fetch(
    `${mountBasePath()}/api/queues/${encodeURIComponent(queueName)}/empty`,
    { method: 'POST' },
  );
  if (response.status === 404) {
    throw new Error('Queue not found.');
  }
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(errorBody.message ?? 'Empty queue failed.');
  }
}

export async function createQueueJob(
  queueName: string,
  body: { name?: string; data: unknown; opts?: Record<string, unknown> },
): Promise<{ id: string }> {
  const response = await fetch(
    `${mountBasePath()}/api/queues/${encodeURIComponent(queueName)}/jobs`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(errorBody.message ?? 'Create job failed.');
  }
  return response.json() as Promise<{ id: string }>;
}

export async function duplicateQueueJob(
  queueName: string,
  sourceJobId: string,
  body: { name?: string; data?: unknown; opts?: Record<string, unknown> },
): Promise<{ id: string }> {
  const response = await fetch(
    `${mountBasePath()}/api/queues/${encodeURIComponent(queueName)}/jobs/${encodeURIComponent(sourceJobId)}/duplicate`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(errorBody.message ?? 'Duplicate job failed.');
  }
  return response.json() as Promise<{ id: string }>;
}

export async function fetchJobs(
  queueName: string,
  status: JobsQueryStatus,
  start = 0,
  end = 79,
) {
  const params = new URLSearchParams({
    status,
    start: String(start),
    end: String(end),
  });
  const response = await fetch(
    `${mountBasePath()}/api/queues/${encodeURIComponent(queueName)}/jobs?${params}`,
  );
  if (!response.ok) {
    throw new Error('Jobs failed to load');
  }
  return response.json() as Promise<{
    jobs: JobRow[];
    status: JobsQueryStatus;
    start: number;
    end: number;
  }>;
}

export interface QueueSummary {
  name: string;
  counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  };
  isPaused: boolean;
}

export interface JobRow {
  id: string;
  name: string;
  data: unknown;
  /** Bull `job.opts` as returned by the API (full object). */
  opts: Record<string, unknown>;
  progress: unknown;
  returnvalue: unknown;
  failedReason: string;
  stacktrace: string[] | null;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
  attemptsMade: number;
  /** Bull state when listing merged or cross-queue results. */
  state?: JobStatus;
  /** Source queue when using {@link ALL_QUEUES_SENTINEL}. */
  queueName?: string;
  /** Bull `job.log()` lines — only on single-job `GET …/jobs/:id`. */
  logs?: string[];
  logCount?: number;
}

export interface JobRuntimeByName {
  queueName: string;
  name: string;
  count: number;
  avgMs: number;
  maxMs: number;
  minMs: number;
}

export interface JobRuntimeHistogramBucket {
  label: string;
  count: number;
}

export interface SlowestRun {
  queueName: string;
  name: string;
  id: string;
  durationMs: number;
  finishedOn: number;
  status: 'completed' | 'failed';
}

export interface JobRuntimeStats {
  perQueueSampleLimit: number;
  completedJobsSampled: number;
  failedJobsSampled: number;
  byJobName: JobRuntimeByName[];
  slowestRuns: SlowestRun[];
  durationHistogram: JobRuntimeHistogramBucket[];
}

export async function fetchJobRuntimeStats(
  perQueue = 120,
  /** Only jobs with `finishedOn` ≥ this (unix ms). Omit for no lower bound. */
  minFinishedOnMs?: number,
  /** When set, only sample this queue. */
  queueName?: string,
) {
  const params = new URLSearchParams({ perQueue: String(perQueue) });
  if (
    minFinishedOnMs != null &&
    Number.isFinite(minFinishedOnMs) &&
    minFinishedOnMs > 0
  ) {
    params.set('minFinishedOn', String(Math.floor(minFinishedOnMs)));
  }
  const q = queueName?.trim();
  if (q) {
    params.set('queue', q);
  }
  const response = await fetch(`${mountBasePath()}/api/stats/job-runtime?${params}`);
  if (!response.ok) {
    throw new Error('Runtime stats failed to load');
  }
  return response.json() as Promise<JobRuntimeStats>;
}

export interface CrossQueueJobLogItem {
  queueName: string;
  job: JobRow;
  state: JobStatus;
}

export interface CrossQueueJobLogResponse {
  items: CrossQueueJobLogItem[];
  sampleSize: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

const JOB_LOG_STATUS_ALL: JobStatus[] = [
  'waiting',
  'active',
  'delayed',
  'completed',
  'failed',
  'paused',
];

export async function fetchJobLog(offset: number, limit: number, statuses: JobStatus[]) {
  const uniqueStatuses = [...new Set(statuses)].filter((status) =>
    JOB_LOG_STATUS_ALL.includes(status),
  );
  const statusParam =
    uniqueStatuses.length === 0 || uniqueStatuses.length === JOB_LOG_STATUS_ALL.length
      ? 'all'
      : uniqueStatuses.join(',');
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
    status: statusParam,
  });
  const response = await fetch(`${mountBasePath()}/api/job-log?${params}`);
  if (!response.ok) {
    throw new Error('Job log failed to load');
  }
  return response.json() as Promise<CrossQueueJobLogResponse>;
}

export type AlertTriggerType =
  | 'job_failed'
  | 'queue_error'
  | 'job_stalled'
  | 'job_completed';

export type AlertPayloadMode = 'template' | 'javascript';

export interface AlertTrigger {
  id: string;
  type: AlertTriggerType;
  queueNames: string[];
  jobNames: string[];
  payloadMode: AlertPayloadMode;
  payloadBody: string;
  /** >0 enables server-side aggregation (debounce / lookback / rate limit). */
  aggregationDebounceMs?: number;
  aggregationLookbackMinutes?: number;
  aggregationMaxWebhooksPerMinute?: number;
}

export interface AlertDefinition {
  id: string;
  name: string;
  enabled: boolean;
  webhookUrl: string;
  httpMethod: 'POST' | 'PUT';
  headers: Record<string, string>;
  triggers: AlertTrigger[];
}

export type AlertsListResponse = {
  alerts: AlertDefinition[];
  configVersion?: number;
};

export async function fetchAlerts(): Promise<AlertsListResponse> {
  const response = await fetch(`${mountBasePath()}/api/alerts`);
  if (!response.ok) {
    throw new Error('Alerts failed to load');
  }
  return response.json();
}

export async function fetchAlertTriggerTypes(): Promise<AlertTriggerType[]> {
  const response = await fetch(`${mountBasePath()}/api/alerts/trigger-types`);
  if (!response.ok) {
    throw new Error('Trigger types failed to load');
  }
  return response.json();
}

export async function fetchSuggestedAlertJobNames(queueNames: string[]): Promise<string[]> {
  const params = new URLSearchParams({
    queues: queueNames.join(','),
  });
  const response = await fetch(
    `${mountBasePath()}/api/alerts/suggested-job-names?${params}`,
  );
  if (!response.ok) {
    throw new Error('Job names failed to load');
  }
  return response.json();
}

export async function createAlert(payload: Omit<AlertDefinition, 'id'>): Promise<AlertDefinition> {
  const response = await fetch(`${mountBasePath()}/api/alerts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(errorBody.message ?? 'Create alert failed');
  }
  return response.json();
}

export async function updateAlert(
  id: string,
  payload: Omit<AlertDefinition, 'id'> & { expectedConfigVersion?: number },
): Promise<AlertDefinition> {
  const response = await fetch(`${mountBasePath()}/api/alerts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (response.status === 409) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      message?: string;
      configVersion?: number | null;
    };
    const err = new Error(
      errorBody.message ?? 'Alert configuration was modified elsewhere.',
    ) as Error & { status: 409 };
    err.status = 409;
    throw err;
  }
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(errorBody.message ?? 'Update alert failed');
  }
  return response.json();
}

export async function deleteAlert(id: string): Promise<void> {
  const response = await fetch(`${mountBasePath()}/api/alerts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Delete alert failed');
  }
}
