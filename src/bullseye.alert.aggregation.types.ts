import type { StoredAggEvent } from './bullseye.alert.aggregation.helpers';

export interface AggBucketState {
  alertId: string;
  triggerId: string;
  queueName: string;
  debounceMs: number;
  lookbackMinutes: number;
  maxWebhooksPerMinute: number;
  events: StoredAggEvent[];
  sendTimestamps: number[];
  scheduledFlushAt: number | null;
}
