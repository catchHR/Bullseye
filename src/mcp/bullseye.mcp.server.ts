import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BullseyeApiService } from '../bullseye.api.service';
import type { BullseyeMcpOptions, JobListItemDto, SingleQueueJobStatus } from '../bullseye.types';

const JOB_STATUS_SCHEMA = z.enum([
  'waiting',
  'active',
  'delayed',
  'completed',
  'failed',
  'paused',
  'all',
]);

function jsonToolResult(data: unknown): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function toolError(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

function maybeStripJob(
  job: JobListItemDto,
  includePayload: boolean,
): JobListItemDto {
  if (includePayload) {
    return job;
  }
  return {
    ...job,
    data: '[omitted — set includePayload: true to include]',
    stacktrace: job.stacktrace?.length ? ['[omitted]'] : job.stacktrace,
    logs: job.logs?.length ? ['[omitted]'] : job.logs,
  };
}

function clampJobRange(start: number | undefined, end: number | undefined) {
  const safeStart = Math.max(0, start ?? 0);
  const safeEnd = Math.max(safeStart, Math.min(end ?? safeStart + 19, safeStart + 199));
  return { start: safeStart, end: safeEnd };
}

export function createBullseyeMcpServer(
  api: BullseyeApiService,
  mcpOptions: BullseyeMcpOptions,
): McpServer {
  const readOnly = mcpOptions.readOnly !== false;
  const server = new McpServer(
    {
      name: 'bullseye',
      version: '0.1.5',
    },
    {
      instructions: readOnly
        ? 'Read-only Bull/BullMQ queue inspector. Use list_queues for an overview, list_jobs for jobs by status, get_job for full job details including logs and stack traces.'
        : 'Bull/BullMQ queue inspector with read and write tools.',
      capabilities: {
        tools: {},
      },
    },
  );

  server.registerTool(
    'list_queues',
    {
      description:
        'List all Bull/BullMQ queues with job counts per state and pause status.',
      inputSchema: {},
    },
    async () => jsonToolResult(await api.getQueueSummaries()),
  );

  server.registerTool(
    'list_jobs',
    {
      description:
        'List jobs for a queue and status. Use status "all" for a merged newest-first view across Bull states.',
      inputSchema: {
        queueName: z
          .string()
          .describe('Queue name (e.g. "email"). Use "__all_queues__" for cross-queue listing.'),
        status: JOB_STATUS_SCHEMA.describe('Bull job state filter'),
        start: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Pagination start index (default 0)'),
        end: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Pagination end index inclusive (default start+19, max span 200)'),
        includePayload: z
          .boolean()
          .optional()
          .describe('Include job data, stacktrace, and logs (default false)'),
      },
    },
    async ({ queueName, status, start, end, includePayload }) => {
      const range = clampJobRange(start, end);
      try {
        let jobs;
        if (queueName === '__all_queues__') {
          jobs = await api.getJobsCrossQueue(status, range.start, range.end);
        } else if (status === 'all') {
          jobs = await api.getJobsMergedAllStatuses(
            queueName,
            range.start,
            range.end,
          );
        } else {
          jobs = await api.getJobs(
            queueName,
            status as SingleQueueJobStatus,
            range.start,
            range.end,
          );
        }
        const strip = includePayload === true;
        return jsonToolResult({
          queueName,
          status,
          start: range.start,
          end: range.end,
          jobs: jobs.map((job) => maybeStripJob(job, strip)),
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'QUEUE_NOT_FOUND') {
          return toolError(`Queue not found: ${queueName}`);
        }
        return toolError(`Failed to list jobs: ${message}`);
      }
    },
  );

  server.registerTool(
    'get_job',
    {
      description:
        'Fetch a single job by queue and id, including logs, stacktrace, and payload.',
      inputSchema: {
        queueName: z.string().describe('Queue name'),
        jobId: z.string().describe('Job id'),
        includePayload: z
          .boolean()
          .optional()
          .describe('Include job data, stacktrace, and logs (default true)'),
      },
    },
    async ({ queueName, jobId, includePayload }) => {
      try {
        const job = await api.getJobById(queueName, jobId);
        if (!job) {
          return toolError(`Job not found: ${queueName}/${jobId}`);
        }
        const strip = includePayload === false;
        return jsonToolResult(maybeStripJob(job, !strip));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return toolError(`Failed to get job: ${message}`);
      }
    },
  );

  server.registerTool(
    'get_job_log',
    {
      description:
        'Cross-queue activity log: merged sample of recent jobs across all queues.',
      inputSchema: {
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Pagination offset (default 0)'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Page size (default 50, max 100)'),
        status: z
          .string()
          .optional()
          .describe(
            'Comma-separated status filter or "all" (default all). Values: waiting, active, delayed, completed, failed, paused',
          ),
        includePayload: z
          .boolean()
          .optional()
          .describe('Include job data and stacktrace per row (default false)'),
      },
    },
    async ({ offset, limit, status, includePayload }) => {
      try {
        const log = await api.getCrossQueueJobLog(offset ?? 0, limit ?? 50, status ?? 'all');
        const strip = includePayload === true;
        return jsonToolResult({
          ...log,
          items: log.items.map((item) => ({
            ...item,
            job: maybeStripJob(item.job, strip),
          })),
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return toolError(`Failed to load job log: ${message}`);
      }
    },
  );

  server.registerTool(
    'get_runtime_stats',
    {
      description:
        'Sample-based runtime statistics from recent completed/failed jobs (duration histogram, slowest runs).',
      inputSchema: {
        perQueue: z
          .number()
          .int()
          .min(20)
          .max(400)
          .optional()
          .describe('Max jobs sampled per queue (default 100)'),
        minFinishedOnMs: z
          .number()
          .int()
          .optional()
          .describe('Only include jobs finished on or after this unix-ms timestamp'),
        queueName: z
          .string()
          .optional()
          .describe('Restrict sampling to a single queue name'),
      },
    },
    async ({ perQueue, minFinishedOnMs, queueName }) => {
      try {
        return jsonToolResult(
          await api.getJobRuntimeStats(
            perQueue ?? 100,
            minFinishedOnMs,
            queueName,
          ),
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return toolError(`Failed to load runtime stats: ${message}`);
      }
    },
  );

  server.registerTool(
    'list_repeatable_jobs',
    {
      description: 'List repeatable (cron/interval) jobs across all queues.',
      inputSchema: {},
    },
    async () => jsonToolResult(await api.getRepeatableJobsAcrossQueues()),
  );

  server.registerTool(
    'get_redis_metrics',
    {
      description:
        'Redis server metrics (memory, ops/sec, keyspace hits, connected clients).',
      inputSchema: {},
    },
    async () => jsonToolResult(await api.getRedisMetrics()),
  );

  if (!readOnly) {
    // Phase 2 write tools — registered when readOnly: false
  }

  return server;
}
