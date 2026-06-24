import { createHash } from 'crypto';
import type { BullseyeModuleOptions } from './bullseye.types';

function slugBasePath(basePath: string): string {
  const s = basePath.replace(/^\/+|\/+$/g, '') || 'default';
  return s.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 64);
}

export function resolveAlertsInstanceId(options: BullseyeModuleOptions): string {
  const raw = options.alertsInstanceId?.trim();
  if (raw) {
    return raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64);
  }
  return slugBasePath(options.basePath);
}

export function alertsRedisNamespace(options: BullseyeModuleOptions): string {
  const queuePrefix = (options.prefix ?? 'bull').replace(/:+$/, '');
  const id = resolveAlertsInstanceId(options);
  return `${queuePrefix}:bullseye:alerts:${id}`;
}

export function bucketHash(
  alertId: string,
  triggerId: string,
  queueName: string,
): string {
  return createHash('sha256')
    .update(`${alertId}\0${triggerId}\0${queueName}`, 'utf8')
    .digest('hex');
}

export function redisKeys(ns: string) {
  return {
    config: `${ns}:config`,
    aggDue: `${ns}:agg:due`,
    aggBucket: (h: string) => `${ns}:agg:bucket:${h}`,
    aggLock: (h: string) => `${ns}:agg:lock:${h}`,
  };
}
