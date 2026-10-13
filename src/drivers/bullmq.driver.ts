import { Inject, Logger } from '@nestjs/common';
import IORedis, { type RedisOptions } from 'ioredis';
import {
  BULLSEYE_OPTIONS,
  type BullseyeModuleOptions,
  type CrossQueueJobLogDto,
  type CrossQueueJobLogItemDto,
  type JobListItemDto,
  type JobRuntimeHistogramBucketDto,
  type JobRuntimeStatsDto,
  type JobStatusFilter,
  type SingleQueueJobStatus,
  type QueueSummaryDto,
  type RepeatableJobDto,
  type SlowestRunDto,
} from '../bullseye.types';
import type {
  BullseyeQueueEventHandler,
  QueueDriver,
} from './queue-driver';

type BullMqLib = typeof import('bullmq');

/** BullMQ default job name when `name` is omitted in `queue.add`. */
const BULLMQ_DEFAULT_JOB_NAME = '__default__';

/**
 * BullMQ 6 removed `Queue#getRepeatableJobs()` in favor of Job Schedulers
 * (`getJobSchedulers`). BullMQ 5.16+ exposes both — prefer schedulers, fall back
 * to the legacy API when present.
 */
async function listBullMqRepeatableOrSchedulers(
  queue: import('bullmq').Queue,
): Promise<Array<Record<string, unknown>>> {
  const q = queue as import('bullmq').Queue & {
    getJobSchedulers?: (
      start?: number,
      end?: number,
      asc?: boolean,
    ) => Promise<object[]>;
    getRepeatableJobs?: (
      start?: number,
      end?: number,
      asc?: boolean,
    ) => Promise<object[]>;
  };
  if (typeof q.getJobSchedulers === 'function') {
    return (await q.getJobSchedulers(0, -1, false)).map((row) => ({
      ...(row as unknown as Record<string, unknown>),
    }));
  }
  if (typeof q.getRepeatableJobs === 'function') {
    return (await q.getRepeatableJobs(0, -1, false)).map((row) => ({
      ...(row as unknown as Record<string, unknown>),
    }));
  }
  return [];
}

/**
 * BullMQ schedulers / legacy repeatables expose `pattern` (not always `cron`).
 * Fixed intervals are usually in `every`, but key-derived rows may only have a
 * numeric ms value in the `pattern` slot.
 */
function normalizeBullMqRepeatableScheduling(item: Record<string, unknown>): {
  cron: string | null;
  every: number | null;
} {
  const patternRaw = item['pattern'] ?? item['cron'];
  const patternStr =
    patternRaw != null && patternRaw !== '' ? String(patternRaw).trim() : '';

  let every: number | null = null;
  const everyRaw = item['every'];
  if (everyRaw != null && everyRaw !== '') {
    const n =
      typeof everyRaw === 'number' ? everyRaw : parseInt(String(everyRaw), 10);
    if (Number.isFinite(n) && n > 0) {
      every = n;
    }
  }

  let cron: string | null = null;
  if (patternStr) {
    if (/^\d+$/.test(patternStr)) {
      if (every == null) {
        const n = parseInt(patternStr, 10);
        if (Number.isFinite(n) && n > 0) {
          every = n;
        }
      }
    } else {
      cron = patternStr;
    }
  }

  return { cron, every };
}

export class BullMqDriver implements QueueDriver {
  readonly backend = 'bullmq' as const;

  private readonly logger = new Logger(BullMqDriver.name);
  private readonly bullmq: BullMqLib;
  private readonly scanRedis: IORedis;
  private readonly queueCache = new Map<string, import('bullmq').Queue>();
  private readonly queueEvents = new Map<string, import('bullmq').QueueEvents>();

  constructor(
    @Inject(BULLSEYE_OPTIONS)
    private readonly options: BullseyeModuleOptions,
  ) {
    // Lazy runtime dependency: only required when backend is bullmq.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    this.bullmq = require('bullmq') as BullMqLib;
    this.scanRedis = this.createRedisClient();
  }

  onModuleDestroy() {
    for (const q of this.queueCache.values()) {
      void q.close();
    }
    this.queueCache.clear();
    for (const qe of this.queueEvents.values()) {
      void qe.close();
    }
    this.queueEvents.clear();
    void this.scanRedis.quit();
  }

  private createRedisClient(): IORedis {
    const redis = this.options.redis;
    if (typeof redis === 'string') {
      return new IORedis(redis);
    }
    const opts = { ...(redis as RedisOptions) } as RedisOptions;
    delete (opts as any).keyPrefix;
    return new IORedis(opts);
  }

  private effectiveKeyPrefix(): string {
    const redis = this.options.redis;
    if (typeof redis === 'object' && redis !== null && !Array.isArray(redis)) {
      const fromRedis = (redis as RedisOptions).keyPrefix;
      if (typeof fromRedis === 'string') {
        const normalized = fromRedis.replace(/:+$/, '');
        if (normalized !== '') {
          return normalized;
        }
      }
    }
    const configured = this.options.prefix;
    if (typeof configured === 'string' && configured !== '') {
      return configured;
    }
    return 'bull';
  }

  private keyPrefixesToScan(): string[] {
    const primary = this.effectiveKeyPrefix();
    return primary === 'bull' ? ['bull'] : [primary, 'bull'];
  }

  private parseQueueNameFromMetaKey(key: string, keyPrefix: string): string | null {
    const prefixWithColon = `${keyPrefix}:`;
    if (!key.startsWith(prefixWithColon) || !key.endsWith(':meta')) {
      return null;
    }
    return key.slice(prefixWithColon.length, -':meta'.length) || null;
  }

  private async discoverQueueNamesFromRedis(): Promise<string[]> {
    const prefixes = this.keyPrefixesToScan();
    const names = new Set<string>();
    for (const keyPrefix of prefixes) {
      const pattern = `${keyPrefix}:*:meta`;
      let cursor = '0';
      do {
        const [next, keys] = await this.scanRedis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          500,
        );
        cursor = next;
        for (const key of keys) {
          const queueName = this.parseQueueNameFromMetaKey(key, keyPrefix);
          if (queueName) {
            names.add(queueName);
          }
        }
      } while (cursor !== '0');
    }
    return [...names].sort();
  }

  private getQueue(queueName: string): import('bullmq').Queue {
    const existing = this.queueCache.get(queueName);
    if (existing) {
      return existing;
    }
    const { Queue } = this.bullmq;
    const queue = new Queue(queueName, {
      connection: this.options.redis as any,
      prefix: this.options.prefix,
    });
    this.queueCache.set(queueName, queue);
    return queue;
  }

  async listQueueNames(): Promise<string[]> {
    const manual = [
      ...new Set((this.options.queueNames ?? []).filter(Boolean)),
    ].sort();
    if (manual.length > 0) {
      return manual;
    }
    if (this.options.autoDiscoverQueues === false) {
      return [];
    }
    const discovered = await this.discoverQueueNamesFromRedis();
    if (discovered.length === 0) {
      this.logger.warn(
        `No BullMQ queues found via Redis SCAN (prefixes: ${this.keyPrefixesToScan().join(', ')}). ` +
          'If you expect queues here, verify BullMQ prefix/connection and that queues exist in Redis.',
      );
    }
    return discovered;
  }

  supportsQueueEvents(): boolean {
    return true;
  }

  async attachQueueEvents(
    queueName: string,
    handler: BullseyeQueueEventHandler,
  ): Promise<void> {
    if (this.queueEvents.has(queueName)) {
      return;
    }
    const { QueueEvents } = this.bullmq;
    const queueEvents = new QueueEvents(queueName, {
      connection: this.options.redis as any,
      prefix: this.options.prefix,
    });
    // Ensure the consumer is ready.
    await queueEvents.waitUntilReady();

    queueEvents.on('failed', ({ jobId, failedReason }: any) => {
      handler({
        type: 'job_failed',
        queueName,
        jobId: jobId != null ? String(jobId) : undefined,
        error: failedReason ? new Error(String(failedReason)) : undefined,
      });
    });
    queueEvents.on('stalled', ({ jobId }: any) => {
      handler({
        type: 'job_stalled',
        queueName,
        jobId: jobId != null ? String(jobId) : undefined,
      });
    });
    queueEvents.on('completed', ({ jobId }: any) => {
      handler({
        type: 'job_completed',
        queueName,
        jobId: jobId != null ? String(jobId) : undefined,
      });
    });
    queueEvents.on('error', (error: Error) => {
      handler({ type: 'queue_error', queueName, error });
    });

    this.queueEvents.set(queueName, queueEvents);
  }

  async detachQueueEvents(queueName: string): Promise<void> {
    const qe = this.queueEvents.get(queueName);
    if (!qe) {
      return;
    }
    this.queueEvents.delete(queueName);
    qe.removeAllListeners();
    await qe.close().catch(() => undefined);
  }

  async getQueueSummaries(): Promise<QueueSummaryDto[]> {
    const names = await this.listQueueNames();
    const results: QueueSummaryDto[] = [];
    for (const name of names) {
      const queue = this.getQueue(name);
      // BullMQ 6 removed the `paused` JobType — paused queues keep jobs in `wait`.
      const raw = await queue.getJobCounts(
        'wait',
        'active',
        'completed',
        'failed',
        'delayed',
        'prioritized',
        'waiting-children',
      );
      const isPaused = await (queue as any).isPaused?.();
      const waiting =
        ((raw as any).wait ?? 0) +
        ((raw as any).prioritized ?? 0) +
        ((raw as any)['waiting-children'] ?? 0);
      results.push({
        name,
        counts: {
          waiting,
          active: (raw as any).active ?? 0,
          completed: (raw as any).completed ?? 0,
          failed: (raw as any).failed ?? 0,
          delayed: (raw as any).delayed ?? 0,
          // Always 0 on BullMQ 6+; use `isPaused` for queue pause state.
          paused: (raw as any).paused ?? 0,
        },
        isPaused: Boolean(isPaused),
      });
    }
    return results;
  }

  private async requireKnownQueue(queueName: string): Promise<void> {
    const names = await this.listQueueNames();
    if (!names.includes(queueName)) {
      throw new Error('QUEUE_NOT_FOUND');
    }
  }

  async pauseQueue(queueName: string): Promise<void> {
    await this.requireKnownQueue(queueName);
    const queue = this.getQueue(queueName);
    await (queue as any).pause?.();
  }

  async resumeQueue(queueName: string): Promise<void> {
    await this.requireKnownQueue(queueName);
    const queue = this.getQueue(queueName);
    await (queue as any).resume?.();
  }

  async emptyQueue(queueName: string): Promise<void> {
    await this.requireKnownQueue(queueName);
    const queue = this.getQueue(queueName);
    // BullMQ drain removes waiting jobs; delayed jobs are typically kept.
    // We keep semantics close to Bull's `empty()` by draining waiting jobs.
    await (queue as any).drain?.();
  }

  async getRepeatableJobsAcrossQueues(): Promise<RepeatableJobDto[]> {
    const names = await this.listQueueNames();
    const aggregated: RepeatableJobDto[] = [];
    for (const queueName of names) {
      const queue = this.getQueue(queueName);
      const repeatables = await listBullMqRepeatableOrSchedulers(queue);
      for (const item of repeatables) {
        const { cron, every } = normalizeBullMqRepeatableScheduling(item);
        aggregated.push({
          queueName,
          key: String(item['key'] ?? ''),
          name: String(item['name'] ?? ''),
          id: (item['id'] as string | null | undefined) ?? null,
          cron,
          every,
          next: Number(item['next'] ?? 0),
          endDate: (item['endDate'] as number | null | undefined) ?? null,
          tz: (item['tz'] as string | null | undefined) ?? null,
        });
      }
    }
    aggregated.sort((left, right) => {
      const byQueue = left.queueName.localeCompare(right.queueName);
      if (byQueue !== 0) {
        return byQueue;
      }
      return left.name.localeCompare(right.name);
    });
    return aggregated;
  }

  async listDistinctJobNamesForQueues(queueNames: string[]): Promise<string[]> {
    const names = new Set<string>();
    const knownQueues = new Set(await this.listQueueNames());
    for (const queueName of queueNames) {
      if (!knownQueues.has(queueName)) {
        continue;
      }
      const queue = this.getQueue(queueName);
      const repeatables = await listBullMqRepeatableOrSchedulers(queue);
      for (const item of repeatables) {
        if (item['name']) {
          names.add(String(item['name']));
        }
      }
      const failedSample = await (queue as any).getFailed?.(0, 79);
      if (Array.isArray(failedSample)) {
        for (const job of failedSample) {
          if (job?.name) {
            names.add(String(job.name));
          }
        }
      }
      const completedSample = await (queue as any).getCompleted?.(0, 39);
      if (Array.isArray(completedSample)) {
        for (const job of completedSample) {
          if (job?.name) {
            names.add(String(job.name));
          }
        }
      }
    }
    return [...names].sort((left, right) => left.localeCompare(right));
  }

  private mapJobToDto(job: any): JobListItemDto {
    const opts: Record<string, unknown> =
      job?.opts != null && typeof job.opts === 'object' && !Array.isArray(job.opts)
        ? { ...(job.opts as Record<string, unknown>) }
        : {};
    return {
      id: String(job?.id ?? ''),
      name: String(job?.name ?? ''),
      data: job?.data,
      opts,
      progress: job?.progress,
      returnvalue: job?.returnvalue,
      failedReason: String(job?.failedReason ?? ''),
      stacktrace: Array.isArray(job?.stacktrace) ? job.stacktrace : null,
      timestamp: typeof job?.timestamp === 'number' ? job.timestamp : 0,
      processedOn: typeof job?.processedOn === 'number' ? job.processedOn : null,
      finishedOn: typeof job?.finishedOn === 'number' ? job.finishedOn : null,
      attemptsMade: typeof job?.attemptsMade === 'number' ? job.attemptsMade : 0,
    };
  }

  private bullmqTypesForStatus(status: SingleQueueJobStatus): string[] {
    const map: Record<SingleQueueJobStatus, string[]> = {
      waiting: ['wait', 'waiting', 'prioritized', 'waiting-children'],
      // BullMQ 6+: no separate paused list — callers resolve via isPaused + waiting.
      paused: [],
      active: ['active'],
      delayed: ['delayed'],
      completed: ['completed'],
      failed: ['failed'],
    };
    return map[status];
  }

  private jobListAscending(status: SingleQueueJobStatus): boolean {
    return status !== 'completed' && status !== 'failed';
  }

  async getJobs(
    queueName: string,
    status: SingleQueueJobStatus,
    start: number,
    end: number,
  ): Promise<JobListItemDto[]> {
    const queue = this.getQueue(queueName);
    let effectiveStatus = status;
    if (status === 'paused') {
      const isPaused = Boolean(await (queue as any).isPaused?.());
      if (!isPaused) {
        return [];
      }
      // Paused queues still store jobs as waiting (BullMQ 6+).
      effectiveStatus = 'waiting';
    }
    const types = this.bullmqTypesForStatus(effectiveStatus);
    if (types.length === 0) {
      return [];
    }
    const ascending = this.jobListAscending(effectiveStatus);
    const jobs = await queue.getJobs(types as any, start, end, ascending);
    const filtered = (jobs as any[]).filter((job) => job != null);
    return filtered.map((job) => this.mapJobToDto(job));
  }

  async getJobById(queueName: string, jobId: string): Promise<JobListItemDto | null> {
    const queue = this.getQueue(queueName);
    const { Job } = this.bullmq;
    const job = await Job.fromId(queue, jobId);
    if (!job) {
      return null;
    }
    const dto = this.mapJobToDto(job);
    try {
      const logBundle = await queue.getJobLogs(jobId, 0, 499);
      const logs = Array.isArray(logBundle.logs) ? logBundle.logs : [];
      const logCount =
        typeof logBundle.count === 'number' ? logBundle.count : logs.length;
      return { ...dto, logs, logCount };
    } catch (error) {
      this.logger.warn(
        `getJobLogs failed for queue "${queueName}" job ${jobId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { ...dto, logs: [], logCount: 0 };
    }
  }

  async promoteDelayedJob(queueName: string, jobId: string): Promise<void> {
    const queue = this.getQueue(queueName);
    const { Job } = this.bullmq;
    const job = await Job.fromId(queue, jobId);
    if (!job) {
      throw new Error('JOB_NOT_FOUND');
    }
    const state = await (job as any).getState?.();
    if (state !== 'delayed') {
      throw new Error(`JOB_NOT_DELAYED:${String(state)}`);
    }
    if (typeof (job as any).promote === 'function') {
      await (job as any).promote();
      return;
    }
    throw new Error('JOB_PROMOTE_UNSUPPORTED');
  }

  async removeJob(queueName: string, jobId: string): Promise<void> {
    const queue = this.getQueue(queueName);
    const { Job } = this.bullmq;
    const job = await Job.fromId(queue, jobId);
    if (!job) {
      throw new Error('JOB_NOT_FOUND');
    }
    await (job as any).remove();
  }

  async retryFailedJob(queueName: string, jobId: string): Promise<void> {
    const queue = this.getQueue(queueName);
    const { Job } = this.bullmq;
    const job = await Job.fromId(queue, jobId);
    if (!job) {
      throw new Error('JOB_NOT_FOUND');
    }
    const state = await (job as any).getState?.();
    if (state !== 'failed') {
      throw new Error(`JOB_NOT_FAILED:${String(state)}`);
    }
    await (job as any).retry();
  }

  async addJob(
    queueName: string,
    payload: { name: string; data: unknown; opts?: unknown },
  ): Promise<{ id: string }> {
    const queue = this.getQueue(queueName);
    const name =
      typeof payload.name === 'string' && payload.name.trim() !== ''
        ? payload.name.trim()
        : BULLMQ_DEFAULT_JOB_NAME;
    let data: unknown = payload.data ?? {};
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data) as unknown;
      } catch {
        throw new Error('INVALID_DATA_JSON');
      }
    }
    let opts: Record<string, unknown> = {};
    if (payload.opts !== undefined && payload.opts !== null) {
      let rawOpts: unknown = payload.opts;
      if (typeof rawOpts === 'string') {
        try {
          rawOpts = JSON.parse(rawOpts) as unknown;
        } catch {
          throw new Error('INVALID_OPTS_JSON');
        }
      }
      if (typeof rawOpts !== 'object' || rawOpts === null || Array.isArray(rawOpts)) {
        throw new Error('INVALID_OPTS');
      }
      opts = this.cloneOptsForAdd(rawOpts as Record<string, unknown>);
    }
    const added = await queue.add(name, data as any, opts as any);
    return { id: String((added as any).id) };
  }

  async duplicateJob(
    queueName: string,
    sourceJobId: string,
    overrides: { name?: string; data?: unknown; opts?: unknown },
  ): Promise<{ id: string }> {
    const queue = this.getQueue(queueName);
    const { Job } = this.bullmq;
    const sourceJob = await Job.fromId(queue, sourceJobId);
    if (!sourceJob) {
      throw new Error('JOB_NOT_FOUND');
    }
    const name =
      typeof overrides.name === 'string' && overrides.name.trim() !== ''
        ? overrides.name.trim()
        : sourceJob.name && String(sourceJob.name) !== ''
          ? String(sourceJob.name)
          : BULLMQ_DEFAULT_JOB_NAME;

    let data: unknown = overrides.data !== undefined ? overrides.data : (sourceJob as any).data ?? {};
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data) as unknown;
      } catch {
        throw new Error('INVALID_DATA_JSON');
      }
    }

    const baseOpts = this.cloneOptsForDuplicate(
      (sourceJob as any).opts &&
        typeof (sourceJob as any).opts === 'object' &&
        !Array.isArray((sourceJob as any).opts)
        ? ((sourceJob as any).opts as Record<string, unknown>)
        : {},
    );

    let mergedOpts: Record<string, unknown>;
    if (overrides.opts !== undefined && overrides.opts !== null) {
      let replacement: unknown = overrides.opts;
      if (typeof replacement === 'string') {
        try {
          replacement = JSON.parse(replacement) as unknown;
        } catch {
          throw new Error('INVALID_OPTS_JSON');
        }
      }
      if (typeof replacement !== 'object' || replacement === null || Array.isArray(replacement)) {
        throw new Error('INVALID_OPTS');
      }
      mergedOpts = this.cloneOptsForDuplicate({ ...(replacement as Record<string, unknown>) });
    } else {
      mergedOpts = this.cloneOptsForDuplicate(baseOpts);
    }

    const added = await queue.add(name, data as any, mergedOpts as any);
    return { id: String((added as any).id) };
  }

  private cloneOptsForDuplicate(opts: Record<string, unknown>): Record<string, unknown> {
    const next = { ...opts };
    delete next['jobId'];
    delete next['timestamp'];
    return next;
  }

  private cloneOptsForAdd(opts: Record<string, unknown>): Record<string, unknown> {
    return this.cloneOptsForDuplicate(opts);
  }

  async getCrossQueueJobLog(
    offsetRaw: unknown,
    limitRaw: unknown,
    statusParam: unknown,
  ): Promise<CrossQueueJobLogDto> {
    const offset = Math.max(0, parseInt(String(offsetRaw), 10) || 0);
    const limit = Math.min(Math.max(parseInt(String(limitRaw), 10) || 50, 1), 100);

    const validStatuses: SingleQueueJobStatus[] = [
      'waiting',
      'active',
      'delayed',
      'completed',
      'failed',
      'paused',
    ];
    const requestedStatus = String(statusParam ?? '').trim();
    const status: SingleQueueJobStatus | null = validStatuses.includes(
      requestedStatus as SingleQueueJobStatus,
    )
      ? (requestedStatus as SingleQueueJobStatus)
      : null;

    const queueNames = await this.listQueueNames();
    const perQueueCap = 200;
    let anyQueueHitCap = false;
    const rows: { queueName: string; job: any; sortKey: number }[] = [];

    for (const queueName of queueNames) {
      const queue = this.getQueue(queueName);
      const types = status ? this.bullmqTypesForStatus(status) : ['wait', 'paused', 'active', 'delayed', 'completed', 'failed'];
      const ascending = status ? this.jobListAscending(status) : false;
      const jobs = await queue.getJobs(types as any, 0, perQueueCap - 1, ascending);
      if ((jobs as any[]).length >= perQueueCap) {
        anyQueueHitCap = true;
      }
      for (const job of jobs as any[]) {
        if (!job) {
          continue;
        }
        const dto = this.mapJobToDto(job);
        const sortKey = (dto.processedOn ?? dto.timestamp ?? 0) as number;
        rows.push({ queueName, job, sortKey });
      }
    }

    const seen = new Set<string>();
    const unique: typeof rows = [];
    for (const row of rows) {
      const dedupeKey = `${row.queueName}:${String(row.job.id)}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      unique.push(row);
    }
    unique.sort((left, right) => right.sortKey - left.sortKey);

    const pageSlice = unique.slice(offset, offset + limit);
    const items: CrossQueueJobLogItemDto[] = await Promise.all(
      pageSlice.map(async ({ queueName, job }) => {
        const state = await (job as any).getState?.();
        return {
          queueName,
          job: this.mapJobToDto(job),
          state: this.normalizeJobStatusFilter(String(state)),
        };
      }),
    );

    const hasMoreInMerged = offset + limit < unique.length;
    const mightExistBeyondMerge =
      anyQueueHitCap && pageSlice.length === limit && !hasMoreInMerged;
    const hasMore = hasMoreInMerged || mightExistBeyondMerge;

    return {
      items,
      sampleSize: unique.length,
      offset,
      limit,
      hasMore,
    };
  }

  private normalizeJobStatusFilter(state: string): JobStatusFilter {
    const map: Record<string, JobStatusFilter> = {
      wait: 'waiting',
      waiting: 'waiting',
      paused: 'paused',
      active: 'active',
      delayed: 'delayed',
      completed: 'completed',
      failed: 'failed',
    };
    return map[state] ?? 'waiting';
  }

  async getJobRuntimeStats(
    perQueueRaw: number,
    minFinishedOnMs?: number,
    queueNameFilter?: string,
  ): Promise<JobRuntimeStatsDto> {
    const perQueue = Math.min(Math.max(Math.floor(perQueueRaw) || 100, 20), 400);
    const minFinishedOn =
      minFinishedOnMs != null && Number.isFinite(minFinishedOnMs) && minFinishedOnMs > 0
        ? Math.floor(minFinishedOnMs)
        : undefined;
    const allNames = await this.listQueueNames();
    const filter = queueNameFilter?.trim();
    const queueNames = !filter
      ? allNames
      : allNames.includes(filter)
        ? [filter]
        : [];
    const aggregateByName = new Map<
      string,
      { queueName: string; name: string; durations: number[] }
    >();
    const slowestCandidates: SlowestRunDto[] = [];
    const completedDurationsForHistogram: number[] = [];
    let completedJobsSampled = 0;
    let failedJobsSampled = 0;

    for (const queueName of queueNames) {
      const queue = this.getQueue(queueName);
      const completedJobs = await queue.getJobs(['completed'] as any, 0, perQueue - 1, false);
      for (const job of completedJobs as any[]) {
        const dto = this.mapJobToDto(job);
        if (minFinishedOn != null && (dto.finishedOn == null || dto.finishedOn < minFinishedOn)) {
          continue;
        }
        completedJobsSampled += 1;
        const durationMs = this.jobProcessingDurationMs(dto);
        if (durationMs === null) {
          continue;
        }
        completedDurationsForHistogram.push(durationMs);
        const aggregateKey = `${queueName}\0${dto.name}`;
        let aggregate = aggregateByName.get(aggregateKey);
        if (!aggregate) {
          aggregate = { queueName, name: dto.name, durations: [] };
          aggregateByName.set(aggregateKey, aggregate);
        }
        aggregate.durations.push(durationMs);
        slowestCandidates.push({
          queueName,
          name: dto.name,
          id: dto.id,
          durationMs,
          finishedOn: dto.finishedOn ?? 0,
          status: 'completed',
        });
      }

      const failedJobs = await queue.getJobs(['failed'] as any, 0, perQueue - 1, false);
      for (const job of failedJobs as any[]) {
        const dto = this.mapJobToDto(job);
        if (minFinishedOn != null && (dto.finishedOn == null || dto.finishedOn < minFinishedOn)) {
          continue;
        }
        failedJobsSampled += 1;
        const durationMs = this.jobProcessingDurationMs(dto);
        if (durationMs === null) {
          continue;
        }
        slowestCandidates.push({
          queueName,
          name: dto.name,
          id: dto.id,
          durationMs,
          finishedOn: dto.finishedOn ?? 0,
          status: 'failed',
        });
      }
    }

    slowestCandidates.sort((left, right) => right.durationMs - left.durationMs);

    const byJobName = [...aggregateByName.values()]
      .map((aggregate) => {
        const durations = aggregate.durations;
        const sum = durations.reduce((accumulator, value) => accumulator + value, 0);
        return {
          queueName: aggregate.queueName,
          name: aggregate.name,
          count: durations.length,
          avgMs: sum / durations.length,
          maxMs: Math.max(...durations),
          minMs: Math.min(...durations),
        };
      })
      .sort((left, right) => right.avgMs - left.avgMs);

    return {
      perQueueSampleLimit: perQueue,
      completedJobsSampled,
      failedJobsSampled,
      byJobName,
      slowestRuns: slowestCandidates.slice(0, 25),
      durationHistogram: this.buildDurationHistogram(completedDurationsForHistogram),
    };
  }

  private jobProcessingDurationMs(dto: JobListItemDto): number | null {
    const processedOn = dto.processedOn;
    const finishedOn = dto.finishedOn;
    if (processedOn == null || finishedOn == null || finishedOn < processedOn) {
      return null;
    }
    return finishedOn - processedOn;
  }

  private buildDurationHistogram(durations: number[]): JobRuntimeHistogramBucketDto[] {
    const labels = [
      '<50 ms',
      '50–100 ms',
      '100 ms–500 ms',
      '500 ms–1 s',
      '1–5 s',
      '5–30 s',
      '30 s+',
    ];
    const counts = new Array(labels.length).fill(0) as number[];
    for (const ms of durations) {
      let bucketIndex: number;
      if (ms < 50) {
        bucketIndex = 0;
      } else if (ms < 100) {
        bucketIndex = 1;
      } else if (ms < 500) {
        bucketIndex = 2;
      } else if (ms < 1000) {
        bucketIndex = 3;
      } else if (ms < 5000) {
        bucketIndex = 4;
      } else if (ms < 30000) {
        bucketIndex = 5;
      } else {
        bucketIndex = 6;
      }
      counts[bucketIndex]++;
    }
    return labels.map((label, index) => ({
      label,
      count: counts[index],
    }));
  }
}

