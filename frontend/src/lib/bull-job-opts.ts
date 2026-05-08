/**
 * Bull `queue.add` must not receive the source job’s `opts.timestamp` or `opts.jobId`
 * (reserved / can block enqueue). Strip before UI seeding and before API calls.
 */
export function stripEnqueueMetaFromOpts(
  opts: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (opts == null || typeof opts !== 'object' || Array.isArray(opts)) {
    return {};
  }
  const next = { ...opts };
  delete next['jobId'];
  delete next['timestamp'];
  return next;
}
