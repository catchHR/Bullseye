import type { OnModuleDestroy } from '@nestjs/common';
import type { JobStatusFilter } from '../bullseye.types';
import type {
  CrossQueueJobLogDto,
  JobListItemDto,
  JobRuntimeStatsDto,
  QueueSummaryDto,
  RepeatableJobDto,
} from '../bullseye.types';

export type BullseyeBackend = 'bull' | 'bullmq';

export type BullseyeQueueEventName =
  | 'job_failed'
  | 'job_stalled'
  | 'job_completed'
  | 'queue_error';

export type BullseyeQueueEventHandler = (event: {
  type: BullseyeQueueEventName;
  queueName: string;
  jobId?: string;
  error?: Error;
}) => void;

export interface QueueDriver extends OnModuleDestroy {
  readonly backend: BullseyeBackend;

  listQueueNames(): Promise<string[]>;

  /**
   * Returns a live queue handle for attaching alert listeners, when supported.
   * If the backend doesn't support per-queue event listeners in this process,
   * it can return null and Bullseye will degrade gracefully (alerts disabled).
   */
  supportsQueueEvents(): boolean;
  attachQueueEvents(queueName: string, handler: BullseyeQueueEventHandler): Promise<void>;
  detachQueueEvents(queueName: string): Promise<void>;

  getQueueSummaries(): Promise<QueueSummaryDto[]>;
  pauseQueue(queueName: string): Promise<void>;
  resumeQueue(queueName: string): Promise<void>;
  emptyQueue(queueName: string): Promise<void>;

  getRepeatableJobsAcrossQueues(): Promise<RepeatableJobDto[]>;
  listDistinctJobNamesForQueues(queueNames: string[]): Promise<string[]>;

  getJobs(
    queueName: string,
    status: JobStatusFilter,
    start: number,
    end: number,
  ): Promise<JobListItemDto[]>;

  getJobById(queueName: string, jobId: string): Promise<JobListItemDto | null>;

  promoteDelayedJob(queueName: string, jobId: string): Promise<void>;
  removeJob(queueName: string, jobId: string): Promise<void>;
  retryFailedJob(queueName: string, jobId: string): Promise<void>;

  addJob(
    queueName: string,
    payload: { name: string; data: unknown; opts?: unknown },
  ): Promise<{ id: string }>;

  duplicateJob(
    queueName: string,
    sourceJobId: string,
    overrides: { name?: string; data?: unknown; opts?: unknown },
  ): Promise<{ id: string }>;

  getCrossQueueJobLog(
    offsetRaw: unknown,
    limitRaw: unknown,
    statusParam: unknown,
  ): Promise<CrossQueueJobLogDto>;

  getJobRuntimeStats(
    perQueueRaw: number,
    minFinishedOnMs?: number,
  ): Promise<JobRuntimeStatsDto>;
}

