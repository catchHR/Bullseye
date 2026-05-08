import type { QueueSummary } from '@/lib/api';
import { JOB_STATE_STYLES, OVERVIEW_STATE_ORDER } from '@/lib/status-styles';
import { cn } from '@/lib/utils';

type Props = {
  counts: QueueSummary['counts'];
  className?: string;
};

/** Compact full-width stacked segments: share of jobs per status (decorative). */
export function QueueStatusSegmentBar({ counts, className }: Props) {
  const total = OVERVIEW_STATE_ORDER.reduce((sum, { status }) => sum + (counts[status] ?? 0), 0);

  if (total === 0) {
    return <div className={cn('h-1 w-full shrink-0 rounded-sm bg-muted', className)} aria-hidden />;
  }

  return (
    <div
      className={cn('flex h-1 w-full min-w-0 shrink-0 overflow-hidden rounded-sm bg-muted/40', className)}
      aria-hidden
    >
      {OVERVIEW_STATE_ORDER.map(({ status }) => {
        const count = counts[status] ?? 0;
        if (count <= 0) {
          return null;
        }
        const widthPercent = (count / total) * 100;
        return (
          <div
            key={status}
            className={cn(
              'h-full min-w-[2px] shrink-0',
              JOB_STATE_STYLES[status].dot,
            )}
            style={{ width: `${widthPercent}%` }}
          />
        );
      })}
    </div>
  );
}
