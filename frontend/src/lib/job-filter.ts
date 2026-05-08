import type { JobRow } from '@/lib/api';

function getAtPath(root: unknown, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  let current: unknown = root;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Stable string for comparing payload leaf values (must match extract step). */
export function canonicalPayloadValue(value: unknown): string {
  if (value === undefined) {
    return '';
  }
  if (value === null) {
    return '(null)';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

export function buildJobHaystack(job: JobRow): string {
  return [
    job.id,
    job.name,
    JSON.stringify(job.data),
    JSON.stringify(job.opts),
    JSON.stringify(job.progress),
    JSON.stringify(job.returnvalue),
    job.failedReason ?? '',
    (job.stacktrace ?? []).join('\n'),
  ].join('\n');
}

export type JobFilterOptions = {
  search: string;
  /** Non-empty → job.name must be one of these */
  selectedJobNames: string[];
  /**
   * Per dot-path under `data`: if array non-empty, canonical value at path must be included.
   * Paths with empty arrays are ignored.
   */
  dataPropertySelections: Record<string, string[]>;
};

export function filterJobs(jobs: JobRow[], options: JobFilterOptions): JobRow[] {
  const { search, selectedJobNames, dataPropertySelections } = options;
  const searchTrimmed = search.trim();

  return jobs.filter((job) => {
    if (selectedJobNames.length > 0 && !selectedJobNames.includes(job.name)) {
      return false;
    }

    for (const [path, selectedValues] of Object.entries(dataPropertySelections)) {
      if (selectedValues.length === 0) {
        continue;
      }
      const actual = getAtPath(job.data, path);
      const canon = canonicalPayloadValue(actual);
      if (!selectedValues.includes(canon)) {
        return false;
      }
    }

    if (!searchTrimmed) {
      return true;
    }
    const haystack = buildJobHaystack(job);
    return haystack.toLowerCase().includes(searchTrimmed.toLowerCase());
  });
}
