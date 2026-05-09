import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Express, NextFunction, Request, Response } from 'express';
/** CJS export has no `default` — default import breaks at runtime (Express 5 + `express_1.default`). */
import * as express from 'express';
import expressBasicAuth from 'express-basic-auth';
import { isAbsolute, join, resolve } from 'path';
import { BullseyeAlertService } from './bullseye.alert.service';
import { BullseyeApiService } from './bullseye.api.service';
import {
  ALERT_TRIGGER_TYPES,
  BULLSEYE_ALL_QUEUES_SENTINEL,
  BULLSEYE_OPTIONS,
  BullseyeModuleOptions,
  JobStatusFilter,
} from './bullseye.types';

@Injectable()
export class BullseyeSetupService implements OnModuleInit {
  private readonly logger = new Logger(BullseyeSetupService.name);

  constructor(
    @Inject(BULLSEYE_OPTIONS)
    private readonly options: BullseyeModuleOptions,
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly api: BullseyeApiService,
    private readonly alerts: BullseyeAlertService,
  ) {}

  onModuleInit() {
    const httpAdapter = this.httpAdapterHost.httpAdapter;
    const expressApp = httpAdapter.getInstance() as Express;
    const base = this.normalizeBasePath(this.options.basePath);

    const publicPath = join(__dirname, '..', 'public');
    const router = express.Router();
    router.use(express.json({ limit: '512kb' }));

    // Optional custom favicon (served under the mount path).
    const faviconPathRaw = this.options.faviconPath?.trim();
    if (faviconPathRaw) {
      const faviconPath = isAbsolute(faviconPathRaw)
        ? faviconPathRaw
        : resolve(process.cwd(), faviconPathRaw);
      router.get('/favicon.ico', (_req: Request, res: Response) => {
        res.sendFile(faviconPath, (error) => {
          if (error) {
            this.logger.warn(
              `Failed to serve favicon from "${faviconPath}": ${error.message}`,
            );
            res.status(404).end();
          }
        });
      });
    }

    router.get('/api/ui-config', (_req: Request, res: Response) => {
      const configured = this.options.operator;
      const displayName =
        configured?.displayName != null && String(configured.displayName).trim() !== ''
          ? String(configured.displayName).trim()
          : 'Bullseye';
      const email =
        configured?.email != null && String(configured.email).trim() !== ''
          ? String(configured.email).trim()
          : 'operator@local';
      const rawAvatar = configured?.avatarUrl;
      const avatarUrl =
        rawAvatar != null && String(rawAvatar).trim() !== ''
          ? String(rawAvatar).trim()
          : null;
      res.json({
        operator: { displayName, email, avatarUrl },
      });
    });

    router.get('/api/queues', async (_req: Request, res: Response) => {
      try {
        const queues = await this.api.getQueueSummaries();
        res.json(queues);
      } catch (error) {
        this.logger.error(error);
        res.status(500).json({ message: 'Failed to load queues.' });
      }
    });

    router.get('/api/redis/metrics', async (_req: Request, res: Response) => {
      try {
        const metrics = await this.api.getRedisMetrics();
        res.json(metrics);
      } catch (error) {
        this.logger.error(error);
        res.status(500).json({ message: 'Failed to load Redis metrics.' });
      }
    });

    const decodeQueueNameParam = (rawName: string | string[] | undefined) =>
      decodeURIComponent(Array.isArray(rawName) ? rawName[0] : rawName ?? '');

    router.post('/api/queues/:queueName/pause', async (req: Request, res: Response) => {
      const queueName = decodeQueueNameParam(req.params.queueName);
      try {
        await this.api.pauseQueue(queueName);
        res.status(204).send();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'QUEUE_NOT_FOUND') {
          res.status(404).json({ message: 'Queue not found.' });
          return;
        }
        this.logger.error(error);
        res.status(500).json({ message: 'Failed to pause queue.' });
      }
    });

    router.post('/api/queues/:queueName/resume', async (req: Request, res: Response) => {
      const queueName = decodeQueueNameParam(req.params.queueName);
      try {
        await this.api.resumeQueue(queueName);
        res.status(204).send();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'QUEUE_NOT_FOUND') {
          res.status(404).json({ message: 'Queue not found.' });
          return;
        }
        this.logger.error(error);
        res.status(500).json({ message: 'Failed to resume queue.' });
      }
    });

    router.post('/api/queues/:queueName/empty', async (req: Request, res: Response) => {
      const queueName = decodeQueueNameParam(req.params.queueName);
      try {
        await this.api.emptyQueue(queueName);
        res.status(204).send();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'QUEUE_NOT_FOUND') {
          res.status(404).json({ message: 'Queue not found.' });
          return;
        }
        this.logger.error(error);
        res.status(500).json({ message: 'Failed to empty queue.' });
      }
    });

    router.get('/api/repeatable-jobs', async (_req: Request, res: Response) => {
      try {
        const jobs = await this.api.getRepeatableJobsAcrossQueues();
        res.json(jobs);
      } catch (error) {
        this.logger.error(error);
        res
          .status(500)
          .json({ message: 'Failed to load repeatable jobs.' });
      }
    });

    router.get('/api/stats/job-runtime', async (req: Request, res: Response) => {
      const perQueue = parseInt(String(req.query.perQueue), 10);
      const minFinishedOnRaw = req.query.minFinishedOn;
      let minFinishedOnMs: number | undefined;
      if (minFinishedOnRaw != null && String(minFinishedOnRaw).length > 0) {
        const parsed = Number(String(minFinishedOnRaw));
        if (Number.isFinite(parsed) && parsed > 0) {
          minFinishedOnMs = Math.floor(parsed);
        }
      }
      const queueRaw = req.query.queue;
      const queueFilter =
        typeof queueRaw === 'string' && queueRaw.trim().length > 0
          ? queueRaw.trim()
          : undefined;
      try {
        const stats = await this.api.getJobRuntimeStats(
          perQueue,
          minFinishedOnMs,
          queueFilter,
        );
        res.json(stats);
      } catch (error) {
        this.logger.error(error);
        res.status(500).json({ message: 'Failed to load job runtime stats.' });
      }
    });

    router.get('/api/job-log', async (req: Request, res: Response) => {
      try {
        const log = await this.api.getCrossQueueJobLog(
          req.query.offset,
          req.query.limit,
          req.query.status,
        );
        res.json(log);
      } catch (error) {
        this.logger.error(error);
        res.status(500).json({ message: 'Failed to load job log.' });
      }
    });

    router.get('/api/alerts/trigger-types', (_req: Request, res: Response) => {
      res.json([...ALERT_TRIGGER_TYPES]);
    });

    router.get(
      '/api/alerts/suggested-job-names',
      async (req: Request, res: Response) => {
        const rawQueues = req.query.queues;
        const queueList =
          typeof rawQueues === 'string'
            ? rawQueues
                .split(',')
                .map((queueName) => queueName.trim())
                .filter(Boolean)
            : [];
        try {
          const names = await this.api.listDistinctJobNamesForQueues(queueList);
          res.json(names);
        } catch (error) {
          this.logger.error(error);
          res.status(500).json({ message: 'Failed to load job names.' });
        }
      },
    );

    router.get('/api/alerts', async (_req: Request, res: Response) => {
      try {
        const list = await this.alerts.listAlerts();
        res.json(list);
      } catch (error) {
        this.logger.error(error);
        res.status(500).json({ message: 'Failed to load alerts.' });
      }
    });

    router.post('/api/alerts', async (req: Request, res: Response) => {
      try {
        const created = await this.alerts.createAlert(req.body);
        res.status(201).json(created);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Invalid alert payload.';
        this.logger.warn(message);
        res.status(400).json({ message });
      }
    });

    router.put('/api/alerts/:id', async (req: Request, res: Response) => {
      try {
        const rawAlertId = req.params.id;
        const alertId = Array.isArray(rawAlertId) ? rawAlertId[0] : rawAlertId;
        const updated = await this.alerts.updateAlert(alertId, req.body);
        if (!updated) {
          res.status(404).json({ message: 'Alert not found.' });
          return;
        }
        res.json(updated);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Invalid alert payload.';
        this.logger.warn(message);
        res.status(400).json({ message });
      }
    });

    router.delete('/api/alerts/:id', async (req: Request, res: Response) => {
      try {
        const rawAlertId = req.params.id;
        const alertId = Array.isArray(rawAlertId) ? rawAlertId[0] : rawAlertId;
        const deleted = await this.alerts.deleteAlert(alertId);
        if (!deleted) {
          res.status(404).json({ message: 'Alert not found.' });
          return;
        }
        res.status(204).send();
      } catch (error) {
        this.logger.error(error);
        res.status(500).json({ message: 'Failed to delete alert.' });
      }
    });

    router.get(
      '/api/queues/:queueName/jobs/:jobId',
      async (req: Request, res: Response) => {
        const rawName = req.params.queueName;
        const queueName = decodeURIComponent(
          Array.isArray(rawName) ? rawName[0] : rawName,
        );
        const rawJobId = req.params.jobId;
        const jobId = decodeURIComponent(
          Array.isArray(rawJobId) ? rawJobId[0] : rawJobId,
        );
        try {
          const job = await this.api.getJobById(queueName, jobId);
          if (!job) {
            res.status(404).json({ message: 'Job not found.' });
            return;
          }
          res.json(job);
        } catch (error) {
          this.logger.error(error);
          res.status(500).json({ message: 'Failed to load job.' });
        }
      },
    );

    router.post(
      '/api/queues/:queueName/jobs/:jobId/promote',
      async (req: Request, res: Response) => {
        const rawName = req.params.queueName;
        const queueName = decodeURIComponent(
          Array.isArray(rawName) ? rawName[0] : rawName,
        );
        const rawJobId = req.params.jobId;
        const jobId = decodeURIComponent(
          Array.isArray(rawJobId) ? rawJobId[0] : rawJobId,
        );
        try {
          await this.api.promoteDelayedJob(queueName, jobId);
          res.status(204).send();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          if (message === 'JOB_NOT_FOUND') {
            res.status(404).json({ message: 'Job not found.' });
            return;
          }
          if (message === 'JOB_PROMOTE_UNSUPPORTED') {
            res
              .status(400)
              .json({ message: 'Promote is not supported by this queue backend.' });
            return;
          }
          if (message.startsWith('JOB_NOT_DELAYED:')) {
            res
              .status(400)
              .json({ message: 'Only delayed jobs can be promoted to waiting.' });
            return;
          }
          this.logger.error(error);
          res.status(500).json({ message: 'Failed to promote job.' });
        }
      },
    );

    router.delete(
      '/api/queues/:queueName/jobs/:jobId',
      async (req: Request, res: Response) => {
        const queueName = decodeQueueNameParam(req.params.queueName);
        const jobId = decodeURIComponent(
          Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId ?? '',
        );
        try {
          await this.api.removeJob(queueName, jobId);
          res.status(204).send();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          if (message === 'JOB_NOT_FOUND') {
            res.status(404).json({ message: 'Job not found.' });
            return;
          }
          this.logger.error(error);
          res.status(500).json({ message: 'Failed to remove job.' });
        }
      },
    );

    router.post(
      '/api/queues/:queueName/jobs/:jobId/retry',
      async (req: Request, res: Response) => {
        const queueName = decodeQueueNameParam(req.params.queueName);
        const jobId = decodeURIComponent(
          Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId ?? '',
        );
        try {
          await this.api.retryFailedJob(queueName, jobId);
          res.status(204).send();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          if (message === 'JOB_NOT_FOUND') {
            res.status(404).json({ message: 'Job not found.' });
            return;
          }
          if (message.startsWith('JOB_NOT_FAILED:')) {
            res.status(400).json({ message: 'Only failed jobs can be retried.' });
            return;
          }
          this.logger.error(error);
          res.status(500).json({ message: 'Failed to retry job.' });
        }
      },
    );

    router.post(
      '/api/queues/:queueName/jobs/:jobId/duplicate',
      async (req: Request, res: Response) => {
        const rawName = req.params.queueName;
        const queueName = decodeURIComponent(
          Array.isArray(rawName) ? rawName[0] : rawName,
        );
        const rawJobId = req.params.jobId;
        const sourceJobId = decodeURIComponent(
          Array.isArray(rawJobId) ? rawJobId[0] : rawJobId,
        );
        const body = req.body as {
          name?: string;
          data?: unknown;
          opts?: unknown;
        };
        try {
          const created = await this.api.duplicateJob(queueName, sourceJobId, {
            name: body?.name,
            data: body?.data,
            opts: body?.opts,
          });
          res.status(201).json(created);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          if (message === 'JOB_NOT_FOUND') {
            res.status(404).json({ message: 'Source job not found.' });
            return;
          }
          if (
            message === 'INVALID_DATA_JSON' ||
            message === 'INVALID_OPTS_JSON' ||
            message === 'INVALID_OPTS'
          ) {
            res.status(400).json({ message: 'Invalid JSON in data or opts.' });
            return;
          }
          this.logger.error(error);
          res.status(500).json({ message: 'Failed to duplicate job.' });
        }
      },
    );

    router.post(
      '/api/queues/:queueName/jobs',
      async (req: Request, res: Response) => {
        const rawName = req.params.queueName;
        const queueName = decodeURIComponent(
          Array.isArray(rawName) ? rawName[0] : rawName,
        );
        const body = req.body as {
          name?: string;
          data?: unknown;
          opts?: unknown;
        };
        try {
          const created = await this.api.addJob(queueName, {
            name: typeof body?.name === 'string' ? body.name : '',
            data: body?.data,
            opts: body?.opts,
          });
          res.status(201).json(created);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          if (
            message === 'INVALID_DATA_JSON' ||
            message === 'INVALID_OPTS_JSON' ||
            message === 'INVALID_OPTS'
          ) {
            res.status(400).json({ message: 'Invalid JSON in data or opts.' });
            return;
          }
          this.logger.error(error);
          res.status(500).json({ message: 'Failed to add job.' });
        }
      },
    );

    router.get(
      '/api/queues/:queueName/jobs',
      async (req: Request, res: Response) => {
        const rawName = req.params.queueName;
        const queueName = decodeURIComponent(
          Array.isArray(rawName) ? rawName[0] : rawName,
        );
        const statusParam = (req.query.status as string) || 'waiting';
        const validStatuses: JobStatusFilter[] = [
          'waiting',
          'active',
          'delayed',
          'completed',
          'failed',
          'paused',
          'all',
        ];
        const status = validStatuses.includes(statusParam as JobStatusFilter)
          ? (statusParam as JobStatusFilter)
          : 'waiting';
        const start = Math.max(0, parseInt(String(req.query.start), 10) || 0);
        const end = Math.max(
          start,
          parseInt(String(req.query.end), 10) || start + 19,
        );
        try {
          let jobs;
          if (queueName === BULLSEYE_ALL_QUEUES_SENTINEL) {
            jobs = await this.api.getJobsCrossQueue(status, start, end);
          } else if (status === 'all') {
            jobs = await this.api.getJobsMergedAllStatuses(queueName, start, end);
          } else {
            jobs = await this.api.getJobs(queueName, status, start, end);
          }
          res.json({ jobs, status, start, end });
        } catch (error) {
          this.logger.error(error);
          res
            .status(500)
            .json({ message: 'Failed to load jobs.' });
        }
      },
    );

    const stack: express.RequestHandler[] = [];
    const basicUsername = this.options.basicAuth?.username?.trim() ?? '';
    const basicPassword = this.options.basicAuth?.password ?? '';
    if (basicUsername !== '' && basicPassword !== '') {
      stack.push(
        expressBasicAuth({
          users: {
            [basicUsername]: basicPassword,
          },
          challenge: true,
        }),
      );
      this.logger.log('Bullseye: HTTP Basic Auth is enabled for this mount.');
    }
    if (this.options.middleware) {
      stack.push(this.options.middleware);
    }
    stack.push(router);
    stack.push(
      express.static(publicPath, {
        index: false,
      }),
    );
    stack.push((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET') {
        next();
        return;
      }
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(join(publicPath, 'index.html'));
    });

    expressApp.use(base, ...stack);
    this.logger.log(`Bullseye mounted at "${base}".`);
  }

  private normalizeBasePath(basePath: string): string {
    return basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  }
}
