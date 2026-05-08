import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
/** CJS-Queue-Konstruktor — `import Bull from 'bull'` wird zu `require(...).default` und ist zur Laufzeit undefined. */
import Bull = require('bull');
import IORedis, { type RedisOptions } from 'ioredis';
import { BullMqDriver } from './drivers/bullmq.driver';

/** Bull `Job.DEFAULT_JOB_NAME` when `name` is omitted in `queue.add`. */
const BULL_DEFAULT_JOB_NAME = '__default__';
import {
  BULLSEYE_OPTIONS,
  BullseyeModuleOptions,
  CrossQueueJobLogDto,
  CrossQueueJobLogItemDto,
  JobListItemDto,
  JobRuntimeHistogramBucketDto,
  JobRuntimeStatsDto,
  JobStatusFilter,
  QueueSummaryDto,
  RepeatableJobDto,
  SlowestRunDto,
} from './bullseye.types';

@Injectable()
export class BullseyeApiService implements OnModuleDestroy {
  private readonly logger = new Logger(BullseyeApiService.name);
  private readonly scanRedis: IORedis;
  private readonly queueCache = new Map<string, Bull.Queue>();
  private bullmqDriver: BullMqDriver | null = null;
  private readonly attachedAlertQueues = new Set<string>();

  /** Matches `@nestjs/bull-shared` / `getQueueToken`: `BullQueue_<name>` */
  private static readonly BULL_QUEUE_TOKEN_PREFIX = 'BullQueue_';

  constructor(
    @Inject(BULLSEYE_OPTIONS)
    private readonly options: BullseyeModuleOptions,
    private readonly modulesContainer: ModulesContainer,
  ) {
    this.scanRedis = this.createRedisClient();
  }

  /**
   * Bull does not use ioredis `keyPrefix` (it is stripped internally); keys are stored as
   * `{bullKeyPrefix}:queue:…` in Redis. SCAN must use the real prefix without that option.
   */
  private createRedisClient(): IORedis {
    const redis = this.options.redis;
    if (typeof redis === 'string') {
      return new IORedis(redis);
    }
    const opts = {...(redis as RedisOptions)};
    delete opts.keyPrefix;
    return new IORedis(opts);
  }

  async getRedisMetrics(): Promise<{
    ts: number;
    redisVersion: string | null;
    role: string | null;
    uptimeSec: number | null;
    dbKeys: number | null;
    clients: { connected: number | null; blocked: number | null };
    opsPerSec: number | null;
    keyspace: {
      hits: number | null;
      misses: number | null;
      hitRate: number | null;
    };
    memory: {
      usedBytes: number | null;
      peakBytes: number | null;
      rssBytes: number | null;
      maxBytes: number | null;
      fragmentationRatio: number | null;
    };
  }> {
    const ts = Date.now();
    const infoRaw = await this.scanRedis.info();
    const info = this.parseRedisInfo(infoRaw);

    const dbKeys = await this.scanRedis
      .dbsize()
      .then((n) => (typeof n === 'number' ? n : null))
      .catch(() => null);

    const hits = this.toNumberOrNull(info.keyspace_hits);
    const misses = this.toNumberOrNull(info.keyspace_misses);
    const hitRate =
      hits != null && misses != null && hits + misses > 0
        ? hits / (hits + misses)
        : null;

    return {
      ts,
      redisVersion: info.redis_version ?? null,
      role: info.role ?? null,
      uptimeSec: this.toNumberOrNull(info.uptime_in_seconds),
      dbKeys,
      clients: {
        connected: this.toNumberOrNull(info.connected_clients),
        blocked: this.toNumberOrNull(info.blocked_clients),
      },
      opsPerSec: this.toNumberOrNull(info.instantaneous_ops_per_sec),
      keyspace: { hits, misses, hitRate },
      memory: {
        usedBytes: this.toNumberOrNull(info.used_memory),
        peakBytes: this.toNumberOrNull(info.used_memory_peak),
        rssBytes: this.toNumberOrNull(info.used_memory_rss),
        maxBytes: this.toNumberOrNull(info.maxmemory),
        fragmentationRatio: this.toNumberOrNull(info.mem_fragmentation_ratio),
      },
    };
  }

  private parseRedisInfo(infoRaw: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of infoRaw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const idx = trimmed.indexOf(':');
      if (idx <= 0) {
        continue;
      }
      const key = trimmed.slice(0, idx);
      const value = trimmed.slice(idx + 1);
      out[key] = value;
    }
    return out;
  }

  private toNumberOrNull(value: unknown): number | null {
    if (value == null) {
      return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  onModuleDestroy() {
    for (const queue of this.queueCache.values()) {
      void queue.close();
    }
    this.queueCache.clear();
    void this.scanRedis.quit();
    this.bullmqDriver?.onModuleDestroy();
    this.bullmqDriver = null;
  }

  private usingBullMq(): boolean {
    return this.options.backend === 'bullmq';
  }

  isBullMqBackend(): boolean {
    return this.usingBullMq();
  }

  private getBullMqDriver(): BullMqDriver {
    if (!this.bullmqDriver) {
      this.bullmqDriver = new BullMqDriver(this.options);
    }
    return this.bullmqDriver;
  }

  async attachQueueEvents(
    queueName: string,
    handler: Parameters<BullMqDriver['attachQueueEvents']>[1],
  ): Promise<void> {
    if (!this.usingBullMq()) {
      // For Bull (classic), the alert listener attaches directly to the Bull queue instance.
      return;
    }
    if (this.attachedAlertQueues.has(queueName)) {
      return;
    }
    await this.getBullMqDriver().attachQueueEvents(queueName, handler as any);
    this.attachedAlertQueues.add(queueName);
  }

  /**
   * Shared Queue instance (e.g. alert listener) — same wiring as API read paths.
   */
  getQueueInstance(name: string): Bull.Queue {
    return this.getQueue(name);
  }

  private getQueue(name: string): Bull.Queue {
    const existing = this.queueCache.get(name);
    if (existing) {
      return existing;
    }
    const queue = new Bull(name, {
      redis: this.options.redis,
      prefix: this.options.prefix,
    });
    this.queueCache.set(name, queue);
    return queue;
  }

  async listQueueNames(): Promise<string[]> {
    if (this.usingBullMq()) {
      return this.getBullMqDriver().listQueueNames();
    }
    const manual = [
      ...new Set((this.options.queueNames ?? []).filter(Boolean)),
    ].sort();
    if (manual.length > 0) {
      return manual;
    }
    if (this.options.autoDiscoverQueues === false) {
      return [];
    }

    const fromNest = this.discoverRegisteredBullQueueNames();
    if (fromNest.length > 0) {
      return fromNest.sort();
    }

    return this.discoverQueueNamesFromRedis();
  }

  /**
   * Like Bull Board: queues registered with `BullModule.registerQueue({ name })` in Nest DI
   * (provider token `BullQueue_<name>`).
   */
  private discoverRegisteredBullQueueNames(): string[] {
    const prefix = BullseyeApiService.BULL_QUEUE_TOKEN_PREFIX;
    const names = new Set<string>();
    for (const nestModule of this.modulesContainer.values()) {
      for (const token of nestModule.providers.keys()) {
        if (typeof token === 'string' && token.startsWith(prefix)) {
          names.add(token.slice(prefix.length));
        }
      }
    }
    return [...names];
  }

  /**
   * Matches Bull `this.keyPrefix = opts.redis.keyPrefix || opts.prefix || 'bull'`
   * (see `bull/lib/queue.js`, before `keyPrefix` is removed from Redis options).
   */
  private effectiveBullKeyPrefix(): string {
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

  /** Prefer configured prefix; also scan `bull:` when migrating older keys. */
  private bullKeyPrefixesToScan(): string[] {
    const primary = this.effectiveBullKeyPrefix();
    return primary === 'bull' ? ['bull'] : [primary, 'bull'];
  }

  private async discoverQueueNamesFromRedis(): Promise<string[]> {
    const prefixes = this.bullKeyPrefixesToScan();
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
    const sorted = [...names].sort();
    if (sorted.length === 0) {
      this.logger.warn(
        `No Bull queues found via Redis SCAN (prefixes: ${prefixes.join(', ')}). ` +
          'Check that `prefix` in BullModule matches BullseyeModule (e.g. ENVIRONMENT_NAME).',
      );
    }
    return sorted;
  }

  private parseQueueNameFromMetaKey(
    key: string,
    keyPrefix: string,
  ): string | null {
    const prefixWithColon = `${keyPrefix}:`;
    if (!key.startsWith(prefixWithColon) || !key.endsWith(':meta')) {
      return null;
    }
    return key.slice(prefixWithColon.length, -':meta'.length) || null;
  }

  async getRepeatableJobsAcrossQueues(): Promise<RepeatableJobDto[]> {
    if (this.usingBullMq()) {
      return this.getBullMqDriver().getRepeatableJobsAcrossQueues();
    }
    const names = await this.listQueueNames();
    const aggregated: RepeatableJobDto[] = [];
    for (const queueName of names) {
      const queue = this.getQueue(queueName);
      await queue.isReady();
      const repeatableJobs = await queue.getRepeatableJobs(0, -1, false);
      for (const item of repeatableJobs) {
        aggregated.push({
          queueName,
          key: item.key,
          name: item.name,
          id: item.id ?? null,
          cron: item.cron ?? null,
          every: item.every ?? null,
          next: item.next,
          endDate: item.endDate ?? null,
          tz: item.tz ?? null,
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

  /**
   * For alert configuration: typical job names from repeatable definitions plus small samples.
   */
  async listDistinctJobNamesForQueues(queueNames: string[]): Promise<string[]> {
    if (this.usingBullMq()) {
      return this.getBullMqDriver().listDistinctJobNamesForQueues(queueNames);
    }
    const names = new Set<string>();
    const knownQueues = new Set(await this.listQueueNames());
    for (const queueName of queueNames) {
      if (!knownQueues.has(queueName)) {
        continue;
      }
      const queue = this.getQueue(queueName);
      await queue.isReady();
      const repeatableJobs = await queue.getRepeatableJobs(0, -1, false);
      for (const item of repeatableJobs) {
        if (item.name) {
          names.add(item.name);
        }
      }
      const failedSample = await queue.getJobs(['failed'], 0, 79, false);
      for (const job of failedSample) {
        if (job?.name) {
          names.add(job.name);
        }
      }
      const completedSample = await queue.getJobs(['completed'], 0, 39, false);
      for (const job of completedSample) {
        if (job?.name) {
          names.add(job.name);
        }
      }
    }
    return [...names].sort((left, right) => left.localeCompare(right));
  }

  async getQueueSummaries(): Promise<QueueSummaryDto[]> {
    if (this.usingBullMq()) {
      return this.getBullMqDriver().getQueueSummaries();
    }
    const names = await this.listQueueNames();
    const results: QueueSummaryDto[] = [];
    for (const name of names) {
      const queue = this.getQueue(name);
      await queue.isReady();
      const raw = await queue.getJobCounts();
      const rawWithPaused = raw as Bull.JobCounts & { paused?: number };
      const isPaused = await queue.isPaused();
      results.push({
        name,
        counts: {
          waiting: raw.waiting ?? 0,
          active: raw.active ?? 0,
          completed: raw.completed ?? 0,
          failed: raw.failed ?? 0,
          delayed: raw.delayed ?? 0,
          paused: rawWithPaused.paused ?? 0,
        },
        isPaused,
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

  /**
   * Global pause; does not wait for active jobs to finish (`doNotWaitActive`).
   * @see https://github.com/OptimalBits/bull/blob/develop/REFERENCE.md#queuepause
   */
  async pauseQueue(queueName: string): Promise<void> {
    if (this.usingBullMq()) {
      return this.getBullMqDriver().pauseQueue(queueName);
    }
    await this.requireKnownQueue(queueName);
    const queue = this.getQueue(queueName);
    await queue.isReady();
    await queue.pause(false, true);
  }

  async resumeQueue(queueName: string): Promise<void> {
    if (this.usingBullMq()) {
      return this.getBullMqDriver().resumeQueue(queueName);
    }
    await this.requireKnownQueue(queueName);
    const queue = this.getQueue(queueName);
    await queue.isReady();
    await queue.resume(false);
  }

  /**
   * Removes waiting and delayed jobs only (Bull `empty()`).
   * Active, completed, failed, paused job rows, and repeatable configs stay.
   */
  async emptyQueue(queueName: string): Promise<void> {
    if (this.usingBullMq()) {
      return this.getBullMqDriver().emptyQueue(queueName);
    }
    await this.requireKnownQueue(queueName);
    const queue = this.getQueue(queueName);
    await queue.isReady();
    await queue.empty();
  }

  private mapJobToDto(job: Bull.Job): JobListItemDto {
    const json = job.toJSON();
    const rawOpts = json.opts;
    const opts: Record<string, unknown> =
      rawOpts != null &&
      typeof rawOpts === 'object' &&
      !Array.isArray(rawOpts)
        ? { ...(rawOpts as Record<string, unknown>) }
        : {};
    return {
      id: String(json.id ?? ''),
      name: json.name,
      data: json.data,
      opts,
      progress: json.progress,
      returnvalue: json.returnvalue,
      failedReason: json.failedReason,
      stacktrace: json.stacktrace,
      timestamp: json.timestamp,
      processedOn: json.processedOn,
      finishedOn: json.finishedOn,
      attemptsMade: json.attemptsMade,
    };
  }

  private jobListAscending(status: JobStatusFilter): boolean {
    return status !== 'completed' && status !== 'failed';
  }

  /** Bull-Typen erwarten `JobStatus[]`; Runtime akzeptiert dieselben Status-Strings wie in den `.d.ts`. */
  private bullTypesForStatus(status: JobStatusFilter): Bull.JobStatus[] {
    const map: Record<JobStatusFilter, Bull.JobStatus[]> = {
      waiting: ['waiting'],
      paused: ['paused'],
      active: ['active'],
      delayed: ['delayed'],
      completed: ['completed'],
      failed: ['failed'],
    };
    return map[status];
  }

  async getJobs(
    queueName: string,
    status: JobStatusFilter,
    start: number,
    end: number,
  ): Promise<JobListItemDto[]> {
    if (this.usingBullMq()) {
      return this.getBullMqDriver().getJobs(queueName, status, start, end);
    }
    const queue = this.getQueue(queueName);
    await queue.isReady();
    const types = this.bullTypesForStatus(status);
    const ascending = this.jobListAscending(status);
    const jobs = await queue.getJobs(types, start, end, ascending);
    const filtered = jobs.filter((job) => job != null);
    return filtered.map((job) => this.mapJobToDto(job as Bull.Job));
  }

  async getJobById(
    queueName: string,
    jobId: string,
  ): Promise<JobListItemDto | null> {
    if (this.usingBullMq()) {
      return this.getBullMqDriver().getJobById(queueName, jobId);
    }
    const queue = this.getQueue(queueName);
    await queue.isReady();
    const job = await queue.getJob(jobId);
    if (!job) {
      return null;
    }
    const dto = this.mapJobToDto(job as Bull.Job);
    try {
      const logBundle = (await queue.getJobLogs(jobId, 0, 499)) as {
        logs: string[];
        count: number;
      };
      const logs = Array.isArray(logBundle.logs) ? logBundle.logs : [];
      const logCount =
        typeof logBundle.count === 'number' ? logBundle.count : logs.length;
      return { ...dto, logs, logCount };
    } catch (error) {
      this.logger.warn(
        `getJobLogs failed for queue "${queueName}" job ${jobId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { ...dto, logs: [], logCount: 0 };
    }
  }

  /**
   * Moves a delayed job to the waiting list (Bull `Job#promote`).
   */
  async promoteDelayedJob(queueName: string, jobId: string): Promise<void> {
    if (this.usingBullMq()) {
      return this.getBullMqDriver().promoteDelayedJob(queueName, jobId);
    }
    const queue = this.getQueue(queueName);
    await queue.isReady();
    const job = await queue.getJob(jobId);
    if (!job) {
      throw new Error('JOB_NOT_FOUND');
    }
    const state = await job.getState();
    if (state !== 'delayed') {
      throw new Error(`JOB_NOT_DELAYED:${state}`);
    }
    await (job as Bull.Job).promote();
  }

  /**
   * Removes a job from Redis (`Job#remove`).
   */
  async removeJob(queueName: string, jobId: string): Promise<void> {
    if (this.usingBullMq()) {
      return this.getBullMqDriver().removeJob(queueName, jobId);
    }
    const queue = this.getQueue(queueName);
    await queue.isReady();
    const job = await queue.getJob(jobId);
    if (!job) {
      throw new Error('JOB_NOT_FOUND');
    }
    await (job as Bull.Job).remove();
  }

  /**
   * Re-queues a failed job (`Job#retry`). Only jobs in `failed` state.
   */
  async retryFailedJob(queueName: string, jobId: string): Promise<void> {
    if (this.usingBullMq()) {
      return this.getBullMqDriver().retryFailedJob(queueName, jobId);
    }
    const queue = this.getQueue(queueName);
    await queue.isReady();
    const job = await queue.getJob(jobId);
    if (!job) {
      throw new Error('JOB_NOT_FOUND');
    }
    const state = await job.getState();
    if (state !== 'failed') {
      throw new Error(`JOB_NOT_FAILED:${state}`);
    }
    await (job as Bull.Job).retry();
  }

  /**
   * Enqueues a new job (`Queue#add`).
   */
  async addJob(
    queueName: string,
    payload: { name: string; data: unknown; opts?: unknown },
  ): Promise<{ id: string }> {
    if (this.usingBullMq()) {
      return this.getBullMqDriver().addJob(queueName, payload);
    }
    const queue = this.getQueue(queueName);
    await queue.isReady();
    const name =
      typeof payload.name === 'string' && payload.name.trim() !== ''
        ? payload.name.trim()
        : BULL_DEFAULT_JOB_NAME;
    let data: unknown = payload.data ?? {};
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data) as unknown;
      } catch {
        throw new Error('INVALID_DATA_JSON');
      }
    }
    let opts: Bull.JobOptions = {};
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
    const added = await queue.add(name, data as object, opts);
    return { id: String(added.id) };
  }

  /**
   * Clones a job with optional overrides for name, data, and opts (merged on top of source opts).
   */
  async duplicateJob(
    queueName: string,
    sourceJobId: string,
    overrides: { name?: string; data?: unknown; opts?: unknown },
  ): Promise<{ id: string }> {
    if (this.usingBullMq()) {
      return this.getBullMqDriver().duplicateJob(queueName, sourceJobId, overrides);
    }
    const queue = this.getQueue(queueName);
    await queue.isReady();
    const sourceJob = await queue.getJob(sourceJobId);
    if (!sourceJob) {
      throw new Error('JOB_NOT_FOUND');
    }
    const json = sourceJob.toJSON() as unknown as {
      name?: string;
      data?: unknown;
      opts?: Record<string, unknown>;
    };
    const name =
      typeof overrides.name === 'string' && overrides.name.trim() !== ''
        ? overrides.name.trim()
        : json.name && json.name !== ''
          ? json.name
          : BULL_DEFAULT_JOB_NAME;

    let data: unknown =
      overrides.data !== undefined ? overrides.data : json.data ?? {};
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data) as unknown;
      } catch {
        throw new Error('INVALID_DATA_JSON');
      }
    }

    const rawSourceOpts = json.opts;
    const baseOpts = this.cloneOptsForDuplicate(
      rawSourceOpts &&
        typeof rawSourceOpts === 'object' &&
        !Array.isArray(rawSourceOpts)
        ? (rawSourceOpts as Record<string, unknown>)
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
      if (
        typeof replacement !== 'object' ||
        replacement === null ||
        Array.isArray(replacement)
      ) {
        throw new Error('INVALID_OPTS');
      }
      mergedOpts = this.cloneOptsForDuplicate({
        ...(replacement as Record<string, unknown>),
      });
    } else {
      mergedOpts = this.cloneOptsForDuplicate(baseOpts);
    }
    const added = await queue.add(
      name,
      data as object,
      mergedOpts as Bull.JobOptions,
    );
    return { id: String(added.id) };
  }

  private cloneOptsForDuplicate(opts: Record<string, unknown>): Record<string, unknown> {
    const next = {...opts};
    delete next['jobId'];
    delete next['timestamp'];
    return next;
  }

  private cloneOptsForAdd(opts: Record<string, unknown>): Bull.JobOptions {
    return this.cloneOptsForDuplicate(opts) as Bull.JobOptions;
  }

  /**
   * Cross-queue job log: merges a bounded sample per queue, sorts by start-ish time
   * (`processedOn` ?? `timestamp`), paginates. Not a full global scan.
   */
  async getCrossQueueJobLog(
    offsetRaw: unknown,
    limitRaw: unknown,
    statusParam: unknown,
  ): Promise<CrossQueueJobLogDto> {
    if (this.usingBullMq()) {
      return this.getBullMqDriver().getCrossQueueJobLog(offsetRaw, limitRaw, statusParam);
    }
    const offset = Math.max(0, parseInt(String(offsetRaw), 10) || 0);
    const limit = Math.min(Math.max(parseInt(String(limitRaw), 10) || 50, 1), 100);

    const validStatuses: JobStatusFilter[] = [
      'waiting',
      'active',
      'delayed',
      'completed',
      'failed',
      'paused',
    ];
    const allBullTypes: Bull.JobStatus[] = [
      'waiting',
      'paused',
      'active',
      'delayed',
      'completed',
      'failed',
    ];

    const rawJoined = Array.isArray(statusParam)
      ? statusParam.map(String).join(',')
      : String(statusParam ?? 'all');
    const segments = rawJoined
      .split(',')
      .map((segment) => segment.trim().toLowerCase())
      .filter(Boolean);

    let bullTypes: Bull.JobStatus[];
    if (segments.length === 0 || segments.includes('all')) {
      bullTypes = [...allBullTypes];
    } else {
      const uniqueFilters = [
        ...new Set(
          segments.filter((segment): segment is JobStatusFilter =>
            validStatuses.includes(segment as JobStatusFilter),
          ),
        ),
      ];
      if (uniqueFilters.length === 0) {
        bullTypes = [...allBullTypes];
      } else if (uniqueFilters.length === validStatuses.length) {
        bullTypes = [...allBullTypes];
      } else {
        const picked = new Set<Bull.JobStatus>();
        for (const filter of uniqueFilters) {
          for (const bullType of this.bullTypesForStatus(filter)) {
            picked.add(bullType);
          }
        }
        bullTypes = picked.size > 0 ? Array.from(picked) : [...allBullTypes];
      }
    }

    const maxPull = Math.min(Math.max(offset + limit + 80, 120), 2500);
    const queueNames = await this.listQueueNames();

    const rows: Array<{ queueName: string; job: Bull.Job; sortKey: number }> = [];
    let anyQueueHitCap = false;

    for (const queueName of queueNames) {
      const queue = this.getQueue(queueName);
      await queue.isReady();
      const jobs = await queue.getJobs(bullTypes, 0, maxPull - 1, false);
      const definedJobs = jobs.filter((job): job is Bull.Job => job != null);
      if (definedJobs.length >= maxPull) {
        anyQueueHitCap = true;
      }
      for (const job of definedJobs) {
        const json = job.toJSON();
        const sortKey = json.processedOn ?? json.timestamp ?? 0;
        rows.push({ queueName, job, sortKey });
      }
    }

    rows.sort((left, right) => right.sortKey - left.sortKey);
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
        const bullState = await job.getState();
        const state = this.normalizeJobStatusFilter(String(bullState));
        return {
          queueName,
          job: this.mapJobToDto(job),
          state,
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

  private normalizeJobStatusFilter(bullState: string): JobStatusFilter {
    const map: Record<string, JobStatusFilter> = {
      waiting: 'waiting',
      paused: 'paused',
      active: 'active',
      delayed: 'delayed',
      completed: 'completed',
      failed: 'failed',
    };
    return map[bullState] ?? 'waiting';
  }

  /**
   * Samples newest completed (and failed for “slow runs”) jobs per queue from Redis.
   * Not a full warehouse scan — cheap enough for a dashboard refresh.
   */
  async getJobRuntimeStats(
    perQueueRaw: number,
    /** When set, only include jobs with `finishedOn >= minFinishedOn` (unix ms). */
    minFinishedOnMs?: number,
  ): Promise<JobRuntimeStatsDto> {
    if (this.usingBullMq()) {
      return this.getBullMqDriver().getJobRuntimeStats(perQueueRaw, minFinishedOnMs);
    }
    const perQueue = Math.min(Math.max(Math.floor(perQueueRaw) || 100, 20), 400);
    const minFinishedOn =
      minFinishedOnMs != null &&
      Number.isFinite(minFinishedOnMs) &&
      minFinishedOnMs > 0
        ? Math.floor(minFinishedOnMs)
        : undefined;
    const queueNames = await this.listQueueNames();
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
      await queue.isReady();

      const completedJobs = await queue.getJobs(
        ['completed'],
        0,
        perQueue - 1,
        false,
      );
      for (const job of completedJobs) {
        const dto = this.mapJobToDto(job as Bull.Job);
        if (
          minFinishedOn != null &&
          (dto.finishedOn == null || dto.finishedOn < minFinishedOn)
        ) {
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

      const failedJobs = await queue.getJobs(['failed'], 0, perQueue - 1, false);
      for (const job of failedJobs) {
        const dto = this.mapJobToDto(job as Bull.Job);
        if (
          minFinishedOn != null &&
          (dto.finishedOn == null || dto.finishedOn < minFinishedOn)
        ) {
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
        const sum = durations.reduce(
          (accumulator, value) => accumulator + value,
          0,
        );
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
    if (
      processedOn == null ||
      finishedOn == null ||
      finishedOn < processedOn
    ) {
      return null;
    }
    return finishedOn - processedOn;
  }

  private buildDurationHistogram(
    durations: number[],
  ): JobRuntimeHistogramBucketDto[] {
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
