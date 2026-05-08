import type { JobRow } from '@/lib/api';
import { canonicalPayloadValue } from '@/lib/job-filter';

export function extractDistinctJobNames(jobs: JobRow[]): string[] {
  const names = new Set<string>();
  for (const job of jobs) {
    if (job.name) {
      names.add(job.name);
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

/**
 * Flatten nested plain objects to dot paths; arrays and primitives become leaves.
 */
function flattenLeaves(data: unknown, prefix: string): Array<[string, unknown]> {
  const pairs: Array<[string, unknown]> = [];
  if (data === null || data === undefined) {
    pairs.push([prefix || '(root)', data]);
    return pairs;
  }
  if (Array.isArray(data)) {
    pairs.push([prefix || '(root)', data]);
    return pairs;
  }
  if (typeof data !== 'object') {
    pairs.push([prefix || '(root)', data]);
    return pairs;
  }
  const record = data as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) {
    pairs.push([prefix || '(empty)', data]);
    return pairs;
  }
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = record[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      pairs.push(...flattenLeaves(value, path));
    } else {
      pairs.push([path, value]);
    }
  }
  return pairs;
}

/** path → sorted unique canonical string values observed in the loaded job set */
export function extractDataPropertyOptions(jobs: JobRow[]): Map<string, string[]> {
  const map = new Map<string, Set<string>>();
  for (const job of jobs) {
    const leaves = flattenLeaves(job.data, '');
    for (const [path, value] of leaves) {
      const canonical = canonicalPayloadValue(value);
      if (!map.has(path)) {
        map.set(path, new Set());
      }
      map.get(path)!.add(canonical);
    }
  }
  return new Map(
    [...map.entries()]
      .sort(([pathA], [pathB]) => pathA.localeCompare(pathB))
      .map(([path, valueSet]) => [path, [...valueSet].sort((left, right) => left.localeCompare(right))]),
  );
}
