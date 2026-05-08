import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
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

/**
 * Resolves `{{path}}` placeholders from context; `{{js path}}` → JSON.stringify(value) for valid JSON.
 */
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

@Injectable()
export class BullseyeAlertService {
  private readonly logger = new Logger(BullseyeAlertService.name);
  private writeChain: Promise<void> = Promise.resolve();
  /** In-Memory-Spiegel nach erstem Lesen / Schreiben — vermeidet Disk-I/O bei jedem Job-Event. */
  private alertsSnapshot: AlertDefinitionDto[] | null = null;

  constructor(
    @Inject(BULLSEYE_OPTIONS)
    private readonly options: BullseyeModuleOptions,
  ) {}

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
      this.logger.error(`Failed to read alerts file ${path}: ${error}`);
      return { v: 1, alerts: [] };
    }
  }

  private async ensureLoaded(): Promise<AlertsFileV1> {
    if (this.alertsSnapshot !== null) {
      return { v: 1, alerts: this.alertsSnapshot };
    }
    const file = await this.readFileFromDisk();
    this.alertsSnapshot = file.alerts;
    return file;
  }

  private async writeFile(data: AlertsFileV1): Promise<void> {
    this.alertsSnapshot = data.alerts;
    const path = this.storagePath();
    const json = `${JSON.stringify(data, null, 2)}\n`;
    this.writeChain = this.writeChain.then(async () => {
      await fs.writeFile(path, json, 'utf8');
    });
    await this.writeChain;
  }

  async listAlerts(): Promise<AlertDefinitionDto[]> {
    const file = await this.ensureLoaded();
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
    const file = await this.ensureLoaded();
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
    file.alerts.push(alertItem);
    await this.writeFile(file);
    return alertItem;
  }

  async updateAlert(
    id: string,
    payload: Omit<AlertDefinitionDto, 'id'>,
  ): Promise<AlertDefinitionDto | null> {
    this.validateAlert({ ...payload, id });
    const file = await this.ensureLoaded();
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
    file.alerts[index] = updated;
    await this.writeFile(file);
    return updated;
  }

  async deleteAlert(id: string): Promise<boolean> {
    const file = await this.ensureLoaded();
    const next = file.alerts.filter((alertItem) => alertItem.id !== id);
    if (next.length === file.alerts.length) {
      return false;
    }
    file.alerts = next;
    await this.writeFile(file);
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
        await this.sendWebhook(alertItem, trigger, ctx).catch((error: unknown) => {
          this.logger.warn(
            `Webhook alert "${alertItem.name}" failed: ${error instanceof Error ? error.message : error}`,
          );
        });
      }
    }
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
}
