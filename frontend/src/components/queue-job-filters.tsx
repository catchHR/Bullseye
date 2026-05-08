import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MultiSelect } from '@/components/multi-select';
import { SimpleModal } from '@/components/simple-modal';
import type { JobRow } from '@/lib/api';
import { extractDataPropertyOptions, extractDistinctJobNames } from '@/lib/job-payload-schema';
import { filterJobs } from '@/lib/job-filter';
import { cn } from '@/lib/utils';
import { Filter, X } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type Dispatch, type SetStateAction } from 'react';

type Props = {
  jobs: JobRow[];
  jobsLoading: boolean;
  jobSearch: string;
  setJobSearch: Dispatch<SetStateAction<string>>;
  selectedJobNames: string[];
  setSelectedJobNames: Dispatch<SetStateAction<string[]>>;
  dataPropertySelections: Record<string, string[]>;
  setDataPropertySelections: Dispatch<SetStateAction<Record<string, string[]>>>;
};

const FILTER_LABEL_CLASS =
  'text-[10px] font-medium uppercase tracking-wide text-muted-foreground';

export function QueueJobFilters({
  jobs,
  jobsLoading,
  jobSearch,
  setJobSearch,
  selectedJobNames,
  setSelectedJobNames,
  dataPropertySelections,
  setDataPropertySelections,
}: Props) {
  const searchInputId = useId();
  const [payloadModalOpen, setPayloadModalOpen] = useState(false);

  const jobNameOptions = useMemo(() => extractDistinctJobNames(jobs), [jobs]);

  /** Jobs that match search + job-name filter only — payload options are derived from this set. */
  const jobsMatchingSearchAndNames = useMemo(
    () =>
      filterJobs(jobs, {
        search: jobSearch,
        selectedJobNames,
        dataPropertySelections: {},
      }),
    [jobs, jobSearch, selectedJobNames],
  );

  const dataPropertyOptions = useMemo(
    () => extractDataPropertyOptions(jobsMatchingSearchAndNames),
    [jobsMatchingSearchAndNames],
  );

  useEffect(() => {
    if (jobsLoading) {
      return;
    }
    setDataPropertySelections((previous) => {
      const allowedPaths = new Set(dataPropertyOptions.keys());
      // Until jobs are loaded there are no allowed paths — do not drop URL-driven selections.
      if (allowedPaths.size === 0 && jobs.length === 0) {
        return previous;
      }
      const next: Record<string, string[]> = {};
      let changed = false;
      for (const [path, selectedValues] of Object.entries(previous)) {
        if (!allowedPaths.has(path)) {
          changed = true;
          continue;
        }
        const allowedValueSet = new Set(dataPropertyOptions.get(path) ?? []);
        const kept = selectedValues.filter((value) => allowedValueSet.has(value));
        if (kept.length !== selectedValues.length) {
          changed = true;
        }
        if (kept.length > 0) {
          next[path] = kept;
        }
      }
      return changed ? next : previous;
    });
  }, [dataPropertyOptions, jobs.length, jobsLoading, setDataPropertySelections]);

  const payloadActivePaths = useMemo(() => {
    return Object.entries(dataPropertySelections).filter(([, values]) => values.length > 0);
  }, [dataPropertySelections]);

  const payloadFilterCount = useMemo(
    () => payloadActivePaths.reduce((accumulator, [, values]) => accumulator + values.length, 0),
    [payloadActivePaths],
  );

  const hasActiveFilters =
    jobSearch.trim().length > 0 || selectedJobNames.length > 0 || payloadFilterCount > 0;

  const resetAll = () => {
    setJobSearch('');
    setSelectedJobNames([]);
    setDataPropertySelections({});
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/15 px-3 py-2.5 lg:flex-row lg:flex-wrap lg:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-1 lg:max-w-md">
          <Label htmlFor={searchInputId} className={FILTER_LABEL_CLASS}>
            Search
          </Label>
          <Input
            id={searchInputId}
            type="search"
            value={jobSearch}
            onChange={(event) => setJobSearch(event.target.value)}
            placeholder="Text in job payload, id, name…"
            className="min-h-10 font-mono text-[11px] leading-snug md:text-[11px] sm:min-h-9"
            autoComplete="off"
          />
        </div>

        <div className="min-w-0 w-full shrink-0 lg:w-56 xl:w-64">
          <MultiSelect
            label="Job names"
            options={jobNameOptions}
            selected={selectedJobNames}
            onChange={setSelectedJobNames}
            placeholder="All names"
            disabled={jobsLoading || jobNameOptions.length === 0}
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className={FILTER_LABEL_CLASS}>Actions</span>
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-10 gap-1.5 text-xs sm:h-8"
                  disabled={jobsLoading || dataPropertyOptions.size === 0}
                  onClick={() => setPayloadModalOpen(true)}
                >
                  <Filter className="h-3.5 w-3.5 opacity-70" />
                  Payload filters
                  {payloadFilterCount > 0 ? (
                    <Badge variant="secondary" className="h-5 px-1.5 font-mono text-[10px]">
                      {payloadFilterCount}
                    </Badge>
                  ) : null}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[15rem] leading-snug">
                Filter the loaded job slice by values under <span className="font-mono">data.*</span> paths
                (from the current jobs only).
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-10 text-xs text-muted-foreground sm:h-8"
                  disabled={!hasActiveFilters}
                  onClick={resetAll}
                >
                  Reset all
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Clear search, job names, and payload filters</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Active
          </span>
          {jobSearch.trim().length > 0 && (
            <FilterTag
              label={`Search: ${jobSearch.length > 48 ? `${jobSearch.slice(0, 46)}…` : jobSearch}`}
              onRemove={() => setJobSearch('')}
            />
          )}
          {selectedJobNames.map((name) => (
            <FilterTag
              key={name}
              label={`Job: ${name.length > 40 ? `${name.slice(0, 38)}…` : name}`}
              onRemove={() => setSelectedJobNames((previous) => previous.filter((item) => item !== name))}
            />
          ))}
          {payloadActivePaths.map(([path, values]) =>
            values.map((canon) => (
              <FilterTag
                key={`${path}:${canon}`}
                label={`data.${path}: ${canon.length > 36 ? `${canon.slice(0, 34)}…` : canon}`}
                onRemove={() =>
                  setDataPropertySelections((previous) => {
                    const current = previous[path] ?? [];
                    const nextValues = current.filter((value) => value !== canon);
                    const next = { ...previous };
                    if (nextValues.length === 0) {
                      delete next[path];
                    } else {
                      next[path] = nextValues;
                    }
                    return next;
                  })
                }
              />
            )),
          )}
        </div>
      )}

      <SimpleModal
        open={payloadModalOpen}
        onClose={() => setPayloadModalOpen(false)}
        title="Filter by payload fields"
        wide
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setDataPropertySelections({})}>
              Clear payload filters
            </Button>
            <Button type="button" size="sm" onClick={() => setPayloadModalOpen(false)}>
              Done
            </Button>
          </div>
        }
      >
        {dataPropertyOptions.size === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            No payload paths in the current subset. Adjust search or job names, or load jobs that include{' '}
            <code className="rounded bg-muted px-1 font-mono text-[10px]">data</code> fields.
          </p>
        ) : (
          <div className="grid max-h-[min(420px,55vh)] gap-4 overflow-y-auto pr-1 sm:grid-cols-2">
            {[...dataPropertyOptions.entries()].map(([path, values]) => (
              <MultiSelect
                key={path}
                label={`data.${path}`}
                options={values}
                selected={dataPropertySelections[path] ?? []}
                onChange={(next) =>
                  setDataPropertySelections((previous) => ({
                    ...previous,
                    [path]: next,
                  }))
                }
                placeholder="Any"
                disabled={jobsLoading}
              />
            ))}
          </div>
        )}
      </SimpleModal>
    </div>
  );
}

function FilterTag({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Badge
      variant="muted"
      className={cn(
        'inline-flex max-w-[min(100%,20rem)] items-center gap-1 truncate py-1 pl-2 pr-1 font-normal',
      )}
    >
      <span className="min-w-0 truncate font-mono text-[10px]" title={label}>
        {label}
      </span>
      <button
        type="button"
        className="shrink-0 rounded p-0.5 hover:bg-muted-foreground/15"
        aria-label="Remove filter"
        onClick={onRemove}
      >
        <X className="h-3 w-3" />
      </button>
    </Badge>
  );
}
