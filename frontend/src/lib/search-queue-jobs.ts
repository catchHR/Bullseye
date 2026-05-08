import { fetchJobs, type JobRow, type JobStatus, type QueueSummary } from '@/lib/api';

export type JobSearchHit = { queueName: string; job: JobRow; status: JobStatus };

const JOB_STATUSES_FOR_PALETTE_SEARCH: JobStatus[] = ['waiting', 'active', 'failed', 'delayed'];

export function doesJobMatchSearchQuery(job: JobRow, queryLower: string): boolean {
  if (!queryLower) {
    return true;
  }
  if (String(job.id).toLowerCase().includes(queryLower)) {
    return true;
  }
  if (job.name.toLowerCase().includes(queryLower)) {
    return true;
  }
  try {
    return JSON.stringify(job.data ?? '')
      .toLowerCase()
      .slice(0, 4000)
      .includes(queryLower);
  } catch {
    return false;
  }
}

/**
 * Loads the first jobs per status for each queue and filters client-side.
 * Queues run sequentially; statuses in parallel per queue — caps concurrent requests.
 */
export async function searchJobsAcrossQueues(
  queueSummaries: QueueSummary[],
  queryLower: string,
  options: { signal?: AbortSignal; maxJobsPerStatus?: number } = {},
): Promise<JobSearchHit[]> {
  const maxJobsPerStatus = options.maxJobsPerStatus ?? 24;
  const hits: JobSearchHit[] = [];
  const seenJobKeys = new Set<string>();

  for (const queueSummary of queueSummaries) {
    if (options.signal?.aborted) {
      break;
    }
    const queueName = queueSummary.name;
    await Promise.all(
      JOB_STATUSES_FOR_PALETTE_SEARCH.map(async (status) => {
        if (options.signal?.aborted) {
          return;
        }
        try {
          const response = await fetchJobs(queueName, status, 0, maxJobsPerStatus - 1);
          if (options.signal?.aborted) {
            return;
          }
          for (const job of response.jobs) {
            if (!doesJobMatchSearchQuery(job, queryLower)) {
              continue;
            }
            const dedupeKey = `${queueName}\u0000${job.id}`;
            if (seenJobKeys.has(dedupeKey)) {
              continue;
            }
            seenJobKeys.add(dedupeKey);
            hits.push({ queueName, job, status });
          }
        } catch {
          // Skip this queue/status combination
        }
      }),
    );
  }

  return hits;
}
