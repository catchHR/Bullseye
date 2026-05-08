import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import type { QueueSummary } from '@/lib/api';
import { fetchSuggestedAlertJobNames } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Hash, ListTree, Loader2, Pause } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

const MAX_JOB_NAME_ROWS = 120;

export type QueueJobNameRow = { queueName: string; jobName: string };

export function BullseyeCommandMenu({
  open,
  onOpenChange,
  queues,
  onSelectQueue,
  onSelectJobNameFilter,
}: {
  open: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  queues: QueueSummary[];
  onSelectQueue: (queueName: string) => void;
  onSelectJobNameFilter: (queueName: string, jobName: string) => void;
}) {
  const [paletteSearch, setPaletteSearch] = useState('');
  const [jobNameRows, setJobNameRows] = useState<QueueJobNameRow[]>([]);
  const [jobNamesLoading, setJobNamesLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setPaletteSearch('');
      setJobNameRows([]);
      setJobNamesLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || queues.length === 0) {
      return;
    }

    let cancelled = false;
    setJobNamesLoading(true);

    void Promise.all(
      queues.map(async (queue) => {
        try {
          const names = await fetchSuggestedAlertJobNames([queue.name]);
          if (cancelled) {
            return [] as QueueJobNameRow[];
          }
          return names.map((jobName) => ({ queueName: queue.name, jobName }));
        } catch {
          return [] as QueueJobNameRow[];
        }
      }),
    ).then((chunks) => {
      if (cancelled) {
        return;
      }
      const merged = chunks.flat();
      merged.sort((left, right) => {
        const byQueue = left.queueName.localeCompare(right.queueName);
        return byQueue !== 0 ? byQueue : left.jobName.localeCompare(right.jobName);
      });
      setJobNameRows(merged);
      setJobNamesLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [open, queues]);

  const queryNormalized = paletteSearch.trim().toLowerCase();

  const filteredQueues = useMemo(() => {
    if (!queryNormalized) {
      return queues;
    }
    return queues.filter((queue) => queue.name.toLowerCase().includes(queryNormalized));
  }, [queues, queryNormalized]);

  const filteredJobNameRows = useMemo(() => {
    const source = !queryNormalized
      ? jobNameRows
      : jobNameRows.filter(
          (row) =>
            row.queueName.toLowerCase().includes(queryNormalized) ||
            row.jobName.toLowerCase().includes(queryNormalized),
        );
    return source.slice(0, MAX_JOB_NAME_ROWS);
  }, [jobNameRows, queryNormalized]);

  const handleSelectQueue = useCallback(
    (queueName: string) => {
      onOpenChange(false);
      onSelectQueue(queueName);
    },
    [onOpenChange, onSelectQueue],
  );

  const handleSelectJobNameRow = useCallback(
    (row: QueueJobNameRow) => {
      onOpenChange(false);
      onSelectJobNameFilter(row.queueName, row.jobName);
    },
    [onOpenChange, onSelectJobNameFilter],
  );

  const hasAnyResults = filteredQueues.length > 0 || filteredJobNameRows.length > 0;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search queues or job names…"
        value={paletteSearch}
        onValueChange={setPaletteSearch}
      />
      <CommandList>
        {!hasAnyResults && !jobNamesLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {queryNormalized.length > 0 ? 'No matches.' : 'No queues loaded.'}
          </div>
        ) : null}

        {filteredQueues.length > 0 ? (
          <CommandGroup heading="Queues">
            {filteredQueues.map((queue) => (
              <CommandItem
                key={queue.name}
                value={`queue:${queue.name}`}
                onSelect={() => handleSelectQueue(queue.name)}
                className="font-mono text-[11px]"
              >
                <ListTree className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                {queue.isPaused ? (
                  <Pause
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={1.75}
                    aria-label="Paused"
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate">{queue.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {filteredQueues.length > 0 && filteredJobNameRows.length > 0 ? <CommandSeparator /> : null}

        {filteredJobNameRows.length > 0 ? (
          <CommandGroup heading="Job names (per queue)">
            {filteredJobNameRows.map((row) => (
              <CommandItem
                key={`${row.queueName}\u0000${row.jobName}`}
                value={`jobname:${row.queueName}:${row.jobName}`}
                onSelect={() => handleSelectJobNameRow(row)}
                className="items-start gap-2"
              >
                <Hash className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-mono text-[11px] text-foreground">{row.jobName}</span>
                  <span className="truncate font-mono text-[10px] text-muted-foreground">{row.queueName}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {jobNamesLoading ? (
          <div
            className={cn(
              'flex items-center justify-center gap-2 border-t border-border py-3 text-[11px] text-muted-foreground',
            )}
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Loading job names…
          </div>
        ) : null}

        <p className="border-t border-border px-3 py-2 text-center text-[10px] text-muted-foreground">
          Esc to close · Names from repeatable jobs plus small completed/failed samples
        </p>
      </CommandList>
    </CommandDialog>
  );
}
