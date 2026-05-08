import type { BullRootModuleOptions } from '@nestjs/bull';
import type { NextFunction, Request, Response } from 'express';

export const BULLSEYE_OPTIONS = Symbol('BULLSEYE_OPTIONS');

export type BullseyeExpressMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void;

/** Sidebar account block in the Bullseye SPA (name, email, optional avatar). */
export interface BullseyeOperatorProfile {
  displayName: string;
  email: string;
  /** Optional image URL (e.g. HTTPS). If missing or invalid, the default icon is shown. */
  avatarUrl?: string | null;
}

export interface BullseyeModuleOptions {
  /** Queue backend implementation (default: `bull`). */
  backend?: 'bull' | 'bullmq';
  /** Mount path without trailing slash (e.g. `/queue-dashboard`) */
  basePath: string;
  /**
   * Optional favicon file path to serve as `${basePath}/favicon.ico`.
   * Useful when embedding Bullseye into different apps/environments.
   *
   * Can be absolute or relative to `process.cwd()`.
   */
  faviconPath?: string;
  /** Same Redis / Sentinel as worker queues (`BullModule.forRoot` / BullMQ connection) */
  redis: BullRootModuleOptions['redis'];
  /** Redis key prefix — same as `prefix` in `BullModule.forRoot` */
  prefix?: string;
  /**
   * Optional explicit queue names. Empty = discover all queues from Nest DI
   * (`BullModule.registerQueue`), then fall back to Redis SCAN.
   */
  queueNames?: string[];
  /**
   * Discover queues via Redis SCAN (`{keyPrefix}:*:meta`) when `queueNames` is empty.
   * Default: `true`. Set `false` to disable.
   */
  autoDiscoverQueues?: boolean;
  /**
   * HTTP Basic Auth for the SPA and `/api/*` under `basePath`.
   * Runs before `middleware`. Configure via env — see README (`BULLSEYE_BASIC_AUTH_*`).
   */
  basicAuth?: {
    username: string;
    password: string;
  } | null;
  middleware?: BullseyeExpressMiddleware | null;
  /**
   * Persistence file for configured webhook alerts (JSON).
   * Default: `.bullseye-alerts.json` in the process working directory.
   */
  alertsStoragePath?: string;
  /**
   * Operator info for the SPA sidebar (exposed via `GET …/api/ui-config`).
   * Omit to use built-in defaults (`Bullseye` / `operator@local`, no avatar).
   */
  operator?: BullseyeOperatorProfile | null;
}

/** Bullseye — webhook alerts */
export const ALERT_TRIGGER_TYPES = [
  'job_failed',
  'queue_error',
  'job_stalled',
  'job_completed',
] as const;

export type AlertTriggerType = (typeof ALERT_TRIGGER_TYPES)[number];

export type AlertPayloadMode = 'template' | 'javascript';

export interface AlertTriggerDto {
  id: string;
  type: AlertTriggerType;
  /** Empty = all queues; otherwise restrict to these names */
  queueNames: string[];
  /** Empty = all job names (only relevant for job_* trigger types) */
  jobNames: string[];
  payloadMode: AlertPayloadMode;
  /**
   * template: text/JSON with placeholders `{{queueName}}`, `{{job.id}}`, …
   * javascript: expression using `ctx`; result is sent as JSON (objects → JSON.stringify).
   */
  payloadBody: string;
}

export interface AlertDefinitionDto {
  id: string;
  name: string;
  enabled: boolean;
  webhookUrl: string;
  httpMethod: 'POST' | 'PUT';
  /** Extra HTTP headers (e.g. Discord webhooks often need none). */
  headers: Record<string, string>;
  triggers: AlertTriggerDto[];
}

export interface AlertsFileV1 {
  v: 1;
  alerts: AlertDefinitionDto[];
}

/** Context passed into template / JavaScript payload builders (webhook body). */
export interface AlertDispatchContext {
  trigger: AlertTriggerType;
  queueName: string;
  job: {
    id: string;
    name: string;
    data: unknown;
    failedReason: string;
    stacktrace: string | null;
    attemptsMade: number;
    timestamp: number;
    processedOn: number | null;
    finishedOn: number | null;
  } | null;
  error: { message: string; stack?: string } | null;
}

export type JobStatusFilter =
  | 'waiting'
  | 'active'
  | 'delayed'
  | 'completed'
  | 'failed'
  | 'paused';

export interface QueueSummaryDto {
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

/** Bull `getRepeatableJobs()` — cron and fixed intervals */
export interface RepeatableJobDto {
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

export interface JobListItemDto {
  id: string;
  name: string;
  data: unknown;
  /** Full Bull `job.opts` (serializable subset from `toJSON()`). */
  opts: Record<string, unknown>;
  progress: unknown;
  returnvalue: unknown;
  failedReason: string;
  stacktrace: string[] | null;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
  attemptsMade: number;
  /**
   * Bull `Queue#getJobLogs` — only populated on single-job fetches (`GET …/jobs/:id`),
   * not on list endpoints (avoids extra Redis round-trips per row).
   */
  logs?: string[];
  /** Total log lines stored for this job (can exceed `logs.length`). */
  logCount?: number;
}

/** Aggregated from recent completed jobs per queue (Redis sample). */
export interface JobRuntimeByNameDto {
  queueName: string;
  name: string;
  count: number;
  avgMs: number;
  maxMs: number;
  minMs: number;
}

export interface JobRuntimeHistogramBucketDto {
  label: string;
  count: number;
}

export interface SlowestRunDto {
  queueName: string;
  name: string;
  id: string;
  durationMs: number;
  finishedOn: number;
  status: 'completed' | 'failed';
}

export interface JobRuntimeStatsDto {
  /** Max jobs read per queue for completed / failed samples */
  perQueueSampleLimit: number;
  completedJobsSampled: number;
  failedJobsSampled: number;
  /** Completed jobs only — avg duration by job name (slowest first) */
  byJobName: JobRuntimeByNameDto[];
  /** Single longest runs among sampled completed + failed */
  slowestRuns: SlowestRunDto[];
  /** Distribution of completed job durations (ms) */
  durationHistogram: JobRuntimeHistogramBucketDto[];
}

/** One row in the cross-queue activity log (merged sample from Redis). */
export interface CrossQueueJobLogItemDto {
  queueName: string;
  job: JobListItemDto;
  state: JobStatusFilter;
}

export interface CrossQueueJobLogDto {
  items: CrossQueueJobLogItemDto[];
  /** Rows in the merged sample after dedupe (before paging slice metadata) */
  sampleSize: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}
