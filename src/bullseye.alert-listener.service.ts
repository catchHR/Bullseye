import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type Bull from 'bull';
import type { AlertDispatchContext, AlertTriggerType } from './bullseye.types';
import { BullseyeAlertService } from './bullseye.alert.service';
import { BullseyeApiService } from './bullseye.api.service';

/**
 * Registers Bull queue listeners for webhook alerts.
 *
 * Bull emits these events on the **local** Queue instance — typically when workers run in the
 * **same** Nest process as Bullseye. Separate worker processes will not fire here (Redis alone is not enough).
 */
@Injectable()
export class BullseyeAlertListenerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(BullseyeAlertListenerService.name);
  private readonly attachedQueues = new Set<string>();
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly api: BullseyeApiService,
    private readonly alerts: BullseyeAlertService,
  ) {}

  async onModuleInit() {
    await this.ensureListenersForNewQueues();
    this.refreshInterval = setInterval(() => {
      void this.ensureListenersForNewQueues().catch((error: unknown) => {
        this.logger.error(
          error instanceof Error ? error.message : String(error),
        );
      });
    }, 45000);
  }

  onModuleDestroy() {
    if (this.refreshInterval !== null) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  private async ensureListenersForNewQueues() {
    const names = await this.api.listQueueNames();
    for (const queueName of names) {
      if (this.attachedQueues.has(queueName)) {
        continue;
      }
      try {
        await this.attachQueue(queueName);
        this.attachedQueues.add(queueName);
      } catch (error: unknown) {
        this.logger.warn(
          `Alert listener could not attach to queue "${queueName}": ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  private async attachQueue(queueName: string) {
    const queue = this.api.getQueueInstance(queueName);
    await queue.isReady();

    queue.on('failed', (job: Bull.Job, error: Error) => {
      void this.alerts.dispatchForTrigger('job_failed', queueName, () =>
        this.buildJobContext('job_failed', queueName, job, error),
      );
    });

    queue.on('stalled', (job: Bull.Job) => {
      void this.alerts.dispatchForTrigger('job_stalled', queueName, () =>
        this.buildJobContext('job_stalled', queueName, job),
      );
    });

    queue.on('completed', (job: Bull.Job) => {
      void this.alerts.dispatchForTrigger('job_completed', queueName, () =>
        this.buildJobContext('job_completed', queueName, job),
      );
    });

    queue.on('error', (error: Error) => {
      void this.alerts.dispatchForTrigger('queue_error', queueName, () =>
        this.buildQueueErrorContext(queueName, error),
      );
    });

    this.logger.log(`Alert listeners attached for queue "${queueName}".`);
  }

  private buildJobContext(
    trigger: AlertTriggerType,
    queueName: string,
    job: Bull.Job,
    processingError?: Error,
  ): AlertDispatchContext {
    const json = job.toJSON();
    return {
      trigger,
      queueName,
      job: {
        id: String(json.id ?? ''),
        name: json.name ?? '',
        data: json.data,
        failedReason: json.failedReason ?? '',
        stacktrace: json.stacktrace?.join('\n') ?? null,
        attemptsMade: json.attemptsMade ?? 0,
        timestamp: json.timestamp ?? 0,
        processedOn: json.processedOn ?? null,
        finishedOn: json.finishedOn ?? null,
      },
      error: processingError
        ? {
            message: processingError.message,
            stack: processingError.stack,
          }
        : null,
    };
  }

  private buildQueueErrorContext(
    queueName: string,
    error: Error,
  ): AlertDispatchContext {
    return {
      trigger: 'queue_error',
      queueName,
      job: null,
      error: { message: error.message, stack: error.stack },
    };
  }
}
