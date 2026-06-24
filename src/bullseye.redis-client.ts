import IORedis, { type RedisOptions } from 'ioredis';
import type { BullseyeModuleOptions } from './bullseye.types';

/**
 * Redis client for Bullseye features that must not use ioredis `keyPrefix`
 * (Bull stores keys with the real prefix; SCAN and alert keys must match).
 */
export function createBullseyeScanRedisClient(
  options: BullseyeModuleOptions,
): IORedis {
  const redis = options.redis;
  if (typeof redis === 'string') {
    return new IORedis(redis);
  }
  const opts = {...(redis as RedisOptions)};
  delete opts.keyPrefix;
  return new IORedis(opts);
}
