import type IORedis from 'ioredis';
import {
  AGG_MAX_EVENTS_PER_BUCKET,
  filterEventsByLookback,
  type StoredAggEvent,
} from './bullseye.alert.aggregation.helpers';
import type { AggBucketState } from './bullseye.alert.aggregation.types';
import type { redisKeys } from './bullseye.alert.redis-keys';

function emptyBucket(
  alertId: string,
  triggerId: string,
  queueName: string,
  debounceMs: number,
  lookbackMinutes: number,
  maxWebhooksPerMinute: number,
): AggBucketState {
  return {
    alertId,
    triggerId,
    queueName,
    debounceMs,
    lookbackMinutes,
    maxWebhooksPerMinute,
    events: [],
    sendTimestamps: [],
    scheduledFlushAt: null,
  };
}

function parseBucket(
  raw: string | null,
  meta: {
    alertId: string;
    triggerId: string;
    queueName: string;
    debounceMs: number;
    lookbackMinutes: number;
    maxWebhooksPerMinute: number;
  },
): AggBucketState {
  if (!raw) {
    return emptyBucket(
      meta.alertId,
      meta.triggerId,
      meta.queueName,
      meta.debounceMs,
      meta.lookbackMinutes,
      meta.maxWebhooksPerMinute,
    );
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AggBucketState>;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray(parsed.events) ||
      !Array.isArray(parsed.sendTimestamps)
    ) {
      return emptyBucket(
        meta.alertId,
        meta.triggerId,
        meta.queueName,
        meta.debounceMs,
        meta.lookbackMinutes,
        meta.maxWebhooksPerMinute,
      );
    }
    return {
      alertId: typeof parsed.alertId === 'string' ? parsed.alertId : meta.alertId,
      triggerId: typeof parsed.triggerId === 'string' ? parsed.triggerId : meta.triggerId,
      queueName: typeof parsed.queueName === 'string' ? parsed.queueName : meta.queueName,
      debounceMs:
        typeof parsed.debounceMs === 'number' ? parsed.debounceMs : meta.debounceMs,
      lookbackMinutes:
        typeof parsed.lookbackMinutes === 'number'
          ? parsed.lookbackMinutes
          : meta.lookbackMinutes,
      maxWebhooksPerMinute:
        typeof parsed.maxWebhooksPerMinute === 'number'
          ? parsed.maxWebhooksPerMinute
          : meta.maxWebhooksPerMinute,
      events: parsed.events as StoredAggEvent[],
      sendTimestamps: (parsed.sendTimestamps as number[]).filter(
        (n) => typeof n === 'number' && Number.isFinite(n),
      ),
      scheduledFlushAt:
        typeof parsed.scheduledFlushAt === 'number' ? parsed.scheduledFlushAt : null,
    };
  } catch {
    return emptyBucket(
      meta.alertId,
      meta.triggerId,
      meta.queueName,
      meta.debounceMs,
      meta.lookbackMinutes,
      meta.maxWebhooksPerMinute,
    );
  }
}

export type AppendAggregationOptions = {
  redis: IORedis;
  keys: ReturnType<typeof redisKeys>;
  bucketHash: string;
  alertId: string;
  triggerId: string;
  queueName: string;
  incoming: StoredAggEvent;
  debounceMs: number;
  lookbackMinutes: number;
  maxWebhooksPerMinute: number;
  now: number;
  onCapTrim?: () => void;
};

const MAX_APPEND_RETRIES = 10;

/**
 * Atomically appends an event to the bucket JSON and updates the global due ZSET.
 */
export async function appendAggregationEventRedis(
  options: AppendAggregationOptions,
): Promise<void> {
  const {
    redis,
    keys,
    bucketHash,
    alertId,
    triggerId,
    queueName,
    incoming,
    debounceMs,
    lookbackMinutes,
    maxWebhooksPerMinute,
    now,
    onCapTrim,
  } = options;
  const bucketKey = keys.aggBucket(bucketHash);
  const meta = {
    alertId,
    triggerId,
    queueName,
    debounceMs,
    lookbackMinutes,
    maxWebhooksPerMinute,
  };

  for (let attempt = 0; attempt < MAX_APPEND_RETRIES; attempt++) {
    await redis.watch(bucketKey);
    const raw = await redis.get(bucketKey);
    let state = parseBucket(raw, meta);
    state.events = filterEventsByLookback(state.events, now, lookbackMinutes);
    state.events.push(incoming);
    if (state.events.length > AGG_MAX_EVENTS_PER_BUCKET) {
      onCapTrim?.();
      state.events = state.events.slice(-AGG_MAX_EVENTS_PER_BUCKET);
    }
    state.debounceMs = debounceMs;
    state.lookbackMinutes = lookbackMinutes;
    state.maxWebhooksPerMinute = maxWebhooksPerMinute;
    const nextFlush = Math.max(
      now + debounceMs,
      state.scheduledFlushAt != null ? state.scheduledFlushAt : 0,
    );
    state.scheduledFlushAt = nextFlush;
    const payload = JSON.stringify(state);
    const multi = redis.multi();
    multi.set(bucketKey, payload);
    multi.zadd(keys.aggDue, nextFlush, bucketHash);
    const execResult = await multi.exec();
    if (execResult !== null) {
      return;
    }
  }
  throw new Error('appendAggregationEventRedis: exceeded retry budget (WATCH conflicts)');
}
