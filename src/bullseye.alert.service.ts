import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type IORedis from 'ioredis';
import { appendAggregationEventRedis } from './bullseye.alert.aggregation.redis';
import type { AggBucketState } from './bullseye.alert.aggregation.types';
import {
  aggEventDedupeKey,
  countSendsInWindow,
  effectiveLookbackMinutes,
  effectiveMaxWebhooksPerMinute,
  filterEventsByLookback,
  nextAllowedSendAt,
  trimSendWindow,
  type StoredAggEvent,
} from './bullseye.alert.aggregation.helpers';
import { bucketHash, alertsRedisNamespace, redisKeys } from './bullseye.alert.redis-keys';
import { AlertConfigRedisStore } from './bullseye.alert.redis-store';
import { createBullseyeScanRedisClient } from './bullseye.redis-client';
import {
  ALERT_TRIGGER_TYPES,
  BULLSEYE_OPTIONS,
  type AlertDefinitionDto,
  type AlertDispatchContext,
  type AlertPayloadMode,
  type AlertsFileV1,
  type AlertTriggerDto,
  type AlertTriggerType,
  type BullseyeModuleOptions,
} from './bullseye.types';

export class AlertConfigVersionConflictError extends Error {
  readonly name = 'AlertConfigVersionConflictError';

  constructor(
    public readonly configVersion: number | undefined,
    public readonly alerts: AlertDefinitionDto[],
  ) {
    super('Alert configuration was modified elsewhere.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getByPath(root: unknown, path: string): unknown {
  const segments = path.split('.').filter(Boolean);
  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function renderAlertPayloadTemplate(
  template: string,
  ctx: AlertDispatchContext,
): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_full, rawInner: string) => {
    const inner = String(rawInner).trim();
    if (inner.startsWith('js ')) {
      const path = inner.slice(3).trim();
      const value = getByPath(ctx, path);
      return JSON.stringify(value ?? null);
    }
    const value = getByPath(ctx, inner);
    if (value === undefined || value === null) {
      return '';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  });
}

function buildPayloadBody(
  mode: AlertPayloadMode,
  body: string,
  ctx: AlertDispatchContext,
): string {
  const trimmed = body.trim();
  if (mode === 'javascript') {
    try {
      const fn = new Function(
        'ctx',
        `"use strict"; return (${trimmed});`,
      ) as (c: AlertDispatchContext) => unknown;
      const result = fn(ctx);
      if (typeof result === 'string') {
        return result;
      }
      return JSON.stringify(result ?? null);
    } catch (error) {
      throw new Error(
        `Alert payload javascript error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return renderAlertPayloadTemplate(trimmed, ctx);
}

const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

@Injectable()
export class BullseyeAlertService implements OnModuleDestroy {
  private readonly logger = new Logger(BullseyeAlertService.name);
  private readonly redis: IORedis;
  /** Isolated connection for WATCH/MULTI aggregation (avoids cross-command interleaving). */
  private readonly aggregationRedis: IORedis;
  private readonly store: AlertConfigRedisStore;
  private readonly aggKeys: ReturnType<typeof redisKeys>;
  private readonly capLogMinuteByBucket = new Map<string, number>();

  constructor(
    @Inject(BULLSEYE_OPTIONS)
    private readonly options: BullseyeModuleOptions,
  ) {
    this.redis = createBullseyeScanRedisClient(this.options);
    this.aggregationRedis = this.redis.duplicate();
    this.store = new AlertConfigRedisStore(this.options, this.redis);
    this.aggKeys = redisKeys(alertsRedisNamespace(this.options));
  }

  onModuleDestroy() {
    void this.redis.quit();
    void this.aggregationRedis.quit();
  }

  async getAlertsListResponse(): Promise<{
    alerts: AlertDefinitionDto[];
    configVersion?: number;
  }> {
    const file = await this.store.load();
    return {
      alerts: file.alerts,
      configVersion: file.configVersion,
    };
  }

  async listAlerts(): Promise<AlertDefinitionDto[]> {
    const file = await this.store.load();
    return file.alerts;
  }

  async getAlert(id: string): Promise<AlertDefinitionDto | null> {
    const alerts = await this.listAlerts();
    return alerts.find((alertItem) => alertItem.id === id) ?? null;
  }

  private validateTrigger(trigger: AlertTriggerDto): void {
    if (!(ALERT_TRIGGER_TYPES as readonly string[]).includes(trigger.type)) {
      throw new Error(`Invalid trigger type: ${trigger.type}`);
    }
    if (trigger.payloadMode !== 'template' && trigger.payloadMode !== 'javascript') {
      throw new Error('Invalid payloadMode');
    }
    if (typeof trigger.payloadBody !== 'string') {
      throw new Error('payloadBody must be a string');
    }
    if (trigger.aggregationDebounceMs != null && trigger.aggregationDebounceMs < 0) {
      throw new Error('aggregationDebounceMs must be >= 0');
    }
    if (
      trigger.aggregationLookbackMinutes != null &&
      trigger.aggregationLookbackMinutes <= 0
    ) {
      throw new Error('aggregationLookbackMinutes must be > 0 when set');
    }
    if (
      trigger.aggregationMaxWebhooksPerMinute != null &&
      trigger.aggregationMaxWebhooksPerMinute <= 0
    ) {
      throw new Error('aggregationMaxWebhooksPerMinute must be > 0 when set');
    }
    if (trigger.aggregationDebounceMs != null && trigger.aggregationDebounceMs > 0) {
      if (
        trigger.aggregationMaxWebhooksPerMinute !== undefined &&
        trigger.aggregationMaxWebhooksPerMinute <= 0
      ) {
        throw new Error('aggregationMaxWebhooksPerMinute must be > 0 when set');
      }
    }
  }

  private validateAlert(alertItem: Omit<AlertDefinitionDto, 'id'> & { id?: string }): void {
    if (typeof alertItem.name !== 'string' || alertItem.name.trim() === '') {
      throw new Error('Alert name is required');
    }
    if (typeof alertItem.webhookUrl !== 'string' || alertItem.webhookUrl.trim() === '') {
      throw new Error('webhookUrl is required');
    }
    const method = alertItem.httpMethod ?? 'POST';
    if (method !== 'POST' && method !== 'PUT') {
      throw new Error('httpMethod must be POST or PUT');
    }
    if (!Array.isArray(alertItem.triggers) || alertItem.triggers.length === 0) {
      throw new Error('At least one trigger is required');
    }
    for (const trigger of alertItem.triggers) {
      this.validateTrigger(trigger);
    }
  }

  async createAlert(
    payload: Omit<AlertDefinitionDto, 'id'>,
  ): Promise<AlertDefinitionDto> {
    this.validateAlert(payload);
    const file = await this.store.load();
    const alertItem: AlertDefinitionDto = {
      ...payload,
      id: randomUUID(),
      headers: payload.headers ?? {},
      httpMethod: payload.httpMethod ?? 'POST',
      triggers: payload.triggers.map((trigger) => ({
        ...trigger,
        id: trigger.id || randomUUID(),
      })),
    };
    const next: AlertsFileV1 = { v: 1, alerts: [...file.alerts, alertItem] };
    const result = await this.store.save(undefined, next);
    if (!result.ok) {
      throw new Error('Failed to persist alert (concurrent update). Retry.');
    }
    return alertItem;
  }

  async updateAlert(
    id: string,
    payload: Omit<AlertDefinitionDto, 'id'>,
    opts?: { expectedConfigVersion?: number },
  ): Promise<AlertDefinitionDto | null> {
    this.validateAlert({ ...payload, id });
    const file = await this.store.load();
    const index = file.alerts.findIndex((alertItem) => alertItem.id === id);
    if (index === -1) {
      return null;
    }
    const updated: AlertDefinitionDto = {
      ...payload,
      id,
      headers: payload.headers ?? {},
      httpMethod: payload.httpMethod ?? 'POST',
      triggers: payload.triggers.map((trigger) => ({
        ...trigger,
        id: trigger.id || randomUUID(),
      })),
    };
    const next: AlertsFileV1 = {
      v: 1,
      alerts: file.alerts.map((a, i) => (i === index ? updated : a)),
    };
    const saveResult = await this.store.save(opts?.expectedConfigVersion, next);
    if (saveResult.ok === false) {
      throw new AlertConfigVersionConflictError(
        saveResult.current.configVersion,
        saveResult.current.alerts,
      );
    }
    return updated;
  }

  async deleteAlert(id: string): Promise<boolean> {
    const file = await this.store.load();
    const nextAlerts = file.alerts.filter((alertItem) => alertItem.id !== id);
    if (nextAlerts.length === file.alerts.length) {
      return false;
    }
    const result = await this.store.save(undefined, { v: 1, alerts: nextAlerts });
    if (!result.ok) {
      throw new Error('Failed to delete alert (concurrent update). Retry.');
    }
    return true;
  }

  private matchesQueueFilter(queueNames: string[], queueName: string): boolean {
    if (queueNames.length === 0) {
      return true;
    }
    return queueNames.includes(queueName);
  }

  private matchesJobFilter(jobNames: string[], jobName: string): boolean {
    if (jobNames.length === 0) {
      return true;
    }
    return jobNames.includes(jobName);
  }

  private maybeLogCapExceeded(bucketHash: string): void {
    const minute = Math.floor(Date.now() / 60_000);
    if (this.capLogMinuteByBucket.get(bucketHash) === minute) {
      return;
    }
    this.capLogMinuteByBucket.set(bucketHash, minute);
    this.logger.warn(
      `Aggregation bucket ${bucketHash}: event cap exceeded (oldest entries trimmed).`,
    );
  }

  async dispatchForTrigger(
    triggerType: AlertTriggerType,
    queueName: string,
    buildContext: () => AlertDispatchContext,
  ): Promise<void> {
    const alerts = await this.listAlerts();
    for (const alertItem of alerts) {
      if (!alertItem.enabled) {
        continue;
      }
      for (const trigger of alertItem.triggers) {
        if (trigger.type !== triggerType) {
          continue;
        }
        if (!this.matchesQueueFilter(trigger.queueNames, queueName)) {
          continue;
        }
        const ctx = buildContext();
        if (
          (triggerType === 'job_failed' ||
            triggerType === 'job_stalled' ||
            triggerType === 'job_completed') &&
          ctx.job
        ) {
          if (!this.matchesJobFilter(trigger.jobNames, ctx.job.name)) {
            continue;
          }
        }
        const debounce = trigger.aggregationDebounceMs;
        if (debounce != null && debounce > 0) {
          const bucketHashValue = bucketHash(alertItem.id, trigger.id, queueName);
          const incoming: StoredAggEvent = {
            receivedAt: Date.now(),
            trigger: triggerType,
            queueName,
            job: ctx.job,
            error: ctx.error,
          };
          await appendAggregationEventRedis({
            redis: this.aggregationRedis,
            keys: this.aggKeys,
            bucketHash: bucketHashValue,
            alertId: alertItem.id,
            triggerId: trigger.id,
            queueName,
            incoming,
            debounceMs: debounce,
            lookbackMinutes: effectiveLookbackMinutes(trigger.aggregationLookbackMinutes),
            maxWebhooksPerMinute: effectiveMaxWebhooksPerMinute(
              trigger.aggregationMaxWebhooksPerMinute,
            ),
            now: Date.now(),
            onCapTrim: () => this.maybeLogCapExceeded(bucketHashValue),
          }).catch((error: unknown) => {
            this.logger.warn(
              `Aggregation append failed for "${alertItem.name}": ${error instanceof Error ? error.message : error}`,
            );
          });
        } else {
          await this.sendWebhook(alertItem, trigger, ctx).catch((error: unknown) => {
            this.logger.warn(
              `Webhook alert "${alertItem.name}" failed: ${error instanceof Error ? error.message : error}`,
            );
          });
        }
      }
    }
  }

  buildAggregatedContext(events: StoredAggEvent[]): AlertDispatchContext {
    if (events.length === 0) {
      throw new Error('buildAggregatedContext: empty events');
    }
    const sorted = [...events].sort((a, b) => a.receivedAt - b.receivedAt);
    const last = sorted[sorted.length - 1];
    const aggregation = {
      summary: {
        count: sorted.length,
        firstReceivedAt: sorted[0].receivedAt,
        lastReceivedAt: last.receivedAt,
      },
      events: sorted.map((e) => ({
        receivedAt: e.receivedAt,
        trigger: e.trigger as AlertTriggerType,
        queueName: e.queueName,
        job: e.job as AlertDispatchContext['job'],
        error: e.error as AlertDispatchContext['error'],
      })),
    };
    return {
      trigger: last.trigger as AlertTriggerType,
      queueName: last.queueName,
      job: last.job as AlertDispatchContext['job'],
      error: last.error as AlertDispatchContext['error'],
      aggregation,
    };
  }

  private async sendWebhook(
    alertItem: AlertDefinitionDto,
    trigger: AlertTriggerDto,
    ctx: AlertDispatchContext,
  ): Promise<void> {
    let body: string;
    try {
      body = buildPayloadBody(trigger.payloadMode, trigger.payloadBody, ctx);
    } catch (error) {
      this.logger.error(
        `Alert "${alertItem.name}" payload build failed: ${error instanceof Error ? error.message : error}`,
      );
      return;
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...alertItem.headers,
    };

    const response = await fetch(alertItem.webhookUrl, {
      method: alertItem.httpMethod ?? 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
  }

  /**
   * Polls due aggregation buckets, acquires per-bucket locks, rate-limits, and sends webhooks.
   */
  async tryFlushDueBuckets(now: number = Date.now()): Promise<void> {
    const due = await this.aggregationRedis.zrangebyscore(
      this.aggKeys.aggDue,
      '-inf',
      now,
      'LIMIT',
      0,
      50,
    );
    for (const bucketHash of due) {
      await this.flushOneBucket(bucketHash, now).catch((error: unknown) => {
        this.logger.warn(
          `Aggregation flush failed for ${bucketHash}: ${error instanceof Error ? error.message : error}`,
        );
      });
    }
  }

  private async flushOneBucket(bucketHash: string, now: number): Promise<void> {
    const lockKey = this.aggKeys.aggLock(bucketHash);
    const bucketKey = this.aggKeys.aggBucket(bucketHash);
    const token = randomUUID();
    const got = await this.aggregationRedis.set(lockKey, token, 'PX', 45_000, 'NX');
    if (got !== 'OK') {
      return;
    }
    try {
      const raw = await this.aggregationRedis.get(bucketKey);
      if (!raw) {
        await this.aggregationRedis.zrem(this.aggKeys.aggDue, bucketHash);
        return;
      }
      let state = JSON.parse(raw) as AggBucketState;
      if (
        state.scheduledFlushAt != null &&
        state.scheduledFlushAt > now
      ) {
        await this.aggregationRedis.zadd(this.aggKeys.aggDue, state.scheduledFlushAt, bucketHash);
        return;
      }
      const maxPer = effectiveMaxWebhooksPerMinute(state.maxWebhooksPerMinute);
      const sends = countSendsInWindow(state.sendTimestamps, now);
      if (sends >= maxPer) {
        const trimmed = trimSendWindow(state.sendTimestamps, now);
        const nextAt = nextAllowedSendAt(trimmed, now, maxPer);
        if (nextAt != null) {
          state.scheduledFlushAt = nextAt;
          await this.aggregationRedis.set(bucketKey, JSON.stringify(state));
          await this.aggregationRedis.zadd(this.aggKeys.aggDue, nextAt, bucketHash);
        }
        return;
      }
      const lookback = effectiveLookbackMinutes(state.lookbackMinutes);
      const toSend = filterEventsByLookback(state.events, now, lookback);
      if (toSend.length === 0) {
        state.events = filterEventsByLookback(state.events, now, lookback);
        state.scheduledFlushAt = null;
        if (state.events.length === 0) {
          await this.aggregationRedis.del(bucketKey);
          await this.aggregationRedis.zrem(this.aggKeys.aggDue, bucketHash);
        } else {
          await this.aggregationRedis.set(bucketKey, JSON.stringify(state));
          await this.aggregationRedis.zrem(this.aggKeys.aggDue, bucketHash);
        }
        return;
      }
      const sendKeys = new Set(toSend.map((e) => aggEventDedupeKey(e)));
      const alerts = await this.listAlerts();
      const alertItem = alerts.find((a) => a.id === state.alertId);
      if (!alertItem || !alertItem.enabled) {
        await this.aggregationRedis.del(bucketKey);
        await this.aggregationRedis.zrem(this.aggKeys.aggDue, bucketHash);
        return;
      }
      const trigger = alertItem.triggers.find((t) => t.id === state.triggerId);
      if (!trigger) {
        await this.aggregationRedis.del(bucketKey);
        await this.aggregationRedis.zrem(this.aggKeys.aggDue, bucketHash);
        return;
      }
      const ctx = this.buildAggregatedContext(toSend);
      await this.sendWebhook(alertItem, trigger, ctx);
      const afterRaw = await this.aggregationRedis.get(bucketKey);
      if (!afterRaw) {
        return;
      }
      state = JSON.parse(afterRaw) as AggBucketState;
      state.events = state.events.filter((e) => !sendKeys.has(aggEventDedupeKey(e)));
      state.sendTimestamps = [...state.sendTimestamps, now];
      if (state.events.length === 0) {
        state.scheduledFlushAt = null;
        await this.aggregationRedis.del(bucketKey);
        await this.aggregationRedis.zrem(this.aggKeys.aggDue, bucketHash);
      } else {
        const nextFlush = now + state.debounceMs;
        state.scheduledFlushAt = nextFlush;
        await this.aggregationRedis.set(bucketKey, JSON.stringify(state));
        await this.aggregationRedis.zadd(this.aggKeys.aggDue, nextFlush, bucketHash);
      }
    } finally {
      await this.aggregationRedis.eval(RELEASE_LOCK_LUA, 1, lockKey, token);
    }
  }
}
