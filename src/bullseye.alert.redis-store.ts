import { promises as fs } from 'fs';
import { join } from 'path';
import type IORedis from 'ioredis';
import { alertsRedisNamespace, redisKeys } from './bullseye.alert.redis-keys';
import type { AlertsFileV1, BullseyeModuleOptions } from './bullseye.types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export class AlertConfigRedisStore {
  constructor(
    private readonly options: BullseyeModuleOptions,
    private readonly redis: IORedis,
  ) {}

  private configKey(): string {
    return redisKeys(alertsRedisNamespace(this.options)).config;
  }

  private storagePath(): string {
    return (
      this.options.alertsStoragePath ??
      join(process.cwd(), '.bullseye-alerts.json')
    );
  }

  private async readFileFromDisk(): Promise<AlertsFileV1> {
    const path = this.storagePath();
    try {
      const raw = await fs.readFile(path, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed) || parsed.v !== 1 || !Array.isArray(parsed.alerts)) {
        return { v: 1, alerts: [] };
      }
      return parsed as unknown as AlertsFileV1;
    } catch (error: unknown) {
      const code = isRecord(error) ? error['code'] : undefined;
      if (code === 'ENOENT') {
        return { v: 1, alerts: [] };
      }
      throw error;
    }
  }

  /**
   * Loads alert config from Redis, migrating from the legacy JSON file once when Redis is empty.
   */
  async load(): Promise<AlertsFileV1> {
    const key = this.configKey();
    const raw = await this.redis.get(key);
    if (raw != null && raw !== '') {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed) || parsed.v !== 1 || !Array.isArray(parsed.alerts)) {
          return { v: 1, alerts: [] };
        }
        return parsed as unknown as AlertsFileV1;
      } catch {
        return { v: 1, alerts: [] };
      }
    }
    const fromFile = await this.readFileFromDisk();
    if (fromFile.alerts.length > 0) {
      const migrated: AlertsFileV1 = {
        v: 1,
        alerts: fromFile.alerts,
        configVersion: 1,
      };
      await this.redis.set(key, JSON.stringify(migrated));
      return migrated;
    }
    return { v: 1, alerts: [] };
  }

  /**
   * Optimistic save with optional version check (WATCH/MULTI).
   */
  async save(
    expectedVersion: number | undefined,
    data: AlertsFileV1,
  ): Promise<{ ok: true } | { ok: false; current: AlertsFileV1 }> {
    const key = this.configKey();
    const MAX = 10;
    for (let i = 0; i < MAX; i++) {
      await this.redis.watch(key);
      const raw = await this.redis.get(key);
      let current: AlertsFileV1 =
        raw != null && raw !== ''
          ? (JSON.parse(raw) as AlertsFileV1)
          : { v: 1, alerts: [] };
      if (!Array.isArray(current.alerts)) {
        current = { v: 1, alerts: [] };
      }
      const curVer = current.configVersion ?? 0;
      if (expectedVersion !== undefined && curVer !== expectedVersion) {
        await this.redis.unwatch();
        return { ok: false, current };
      }
      const nextVersion = curVer + 1;
      const toStore: AlertsFileV1 = {
        v: 1,
        alerts: data.alerts,
        configVersion: nextVersion,
      };
      const execResult = await this.redis
        .multi()
        .set(key, JSON.stringify(toStore))
        .exec();
      if (execResult !== null) {
        return { ok: true };
      }
    }
    const raw = await this.redis.get(key);
    const current: AlertsFileV1 =
      raw != null && raw !== ''
        ? (JSON.parse(raw) as AlertsFileV1)
        : { v: 1, alerts: [] };
    return { ok: false, current };
  }
}
