import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { JobStatus } from '@/lib/api';
import { JOB_STATE_STYLES, OVERVIEW_STATE_ORDER } from '@/lib/status-styles';
import { cn } from '@/lib/utils';
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { WheelEvent } from 'react';

/**
 * Radix Dialog + `react-remove-scroll` often swallows wheel events for portaled Popovers.
 * Apply on the scrollable list host so we scroll manually and stop propagation.
 */
function handlePopoverListWheelCapture(event: WheelEvent<HTMLDivElement>) {
  const element = event.currentTarget;
  let deltaPixels = event.deltaY;
  if (event.deltaMode === 1) {
    deltaPixels *= 16;
  } else if (event.deltaMode === 2) {
    deltaPixels *= element.clientHeight;
  }
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
  element.scrollTop = Math.min(
    maxScrollTop,
    Math.max(0, element.scrollTop + deltaPixels),
  );
  event.preventDefault();
  event.stopPropagation();
}

export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  placeholder = 'All',
  disabled,
  className,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const listboxId = useId();
  const searchInputReference = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [filterText, setFilterText] = useState('');

  const filteredOptions = useMemo(() => {
    const query = filterText.trim().toLowerCase();
    if (!query) {
      return options;
    }
    return options.filter((option) => option.toLowerCase().includes(query));
  }, [options, filterText]);

  useEffect(() => {
    if (!open) {
      setFilterText('');
    }
  }, [open]);

  useEffect(() => {
    if (open && options.length > 0) {
      searchInputReference.current?.focus();
    }
  }, [open, options.length]);

  const summary = useMemo(() => {
    if (selected.length === 0) {
      return placeholder;
    }
    if (selected.length === options.length && options.length > 0) {
      return `All (${selected.length})`;
    }
    if (selected.length <= 2) {
      return selected.join(', ');
    }
    return `${selected.length} selected`;
  }, [selected, options.length, placeholder]);

  const toggleValue = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((item) => item !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const selectAll = () => {
    onChange([...options]);
  };

  const clearAll = () => {
    onChange([]);
  };

  return (
    <div className={cn('min-w-0', className)}>
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls={listboxId}
            className="h-auto min-h-9 w-full justify-between gap-2 px-2.5 py-1.5 font-normal"
          >
            <span className="min-w-0 truncate text-left text-[11px]">{summary}</span>
            <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 opacity-60', open && 'rotate-180')} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          id={listboxId}
          align="start"
          className="w-[var(--radix-popover-trigger-width)] p-0"
          role="listbox"
          aria-multiselectable="true"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          {options.length === 0 ? (
            <div className="px-3 py-4">
              <p className="text-[11px] leading-snug text-muted-foreground">
                No options in the loaded jobs — load jobs for this tab or relax filters.
              </p>
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="flex shrink-0 gap-2 border-b border-border bg-muted/40 px-2 py-1.5">
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-[10px] font-medium"
                  onClick={(event) => {
                    event.stopPropagation();
                    selectAll();
                  }}
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-[10px] font-medium text-muted-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    clearAll();
                  }}
                >
                  Clear
                </Button>
              </div>
              <div className="shrink-0 border-b border-border px-2 py-1.5">
                <Input
                  ref={searchInputReference}
                  type="search"
                  value={filterText}
                  onChange={(event) => setFilterText(event.target.value)}
                  placeholder="Search…"
                  autoComplete="off"
                  className="h-8 font-sans text-[11px]"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                />
              </div>
              <div
                className="min-h-0 max-h-[min(280px,45vh)] touch-pan-y overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]"
                onWheelCapture={handlePopoverListWheelCapture}
              >
                <ul className="p-1">
                  {filteredOptions.length === 0 ? (
                    <li className="px-2 py-3 text-[11px] text-muted-foreground">No matches</li>
                  ) : (
                    filteredOptions.map((option) => {
                      const isSelected = selected.includes(option);
                      return (
                        <li key={option}>
                          <label
                            className={cn(
                              'flex w-full cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-left text-[11px] hover:bg-accent/80',
                              isSelected && 'bg-muted/60',
                            )}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleValue(option)}
                              className="mt-0.5"
                              aria-label={option}
                            />
                            <span className="min-w-0 flex-1 break-all font-mono">{option}</span>
                          </label>
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

const JOB_LOG_ALL_STATUSES: JobStatus[] = OVERVIEW_STATE_ORDER.map((row) => row.status);

export function JobLogStatusMultiSelect({
  label,
  selected,
  onChange,
  disabled,
  className,
}: {
  label: string;
  selected: JobStatus[];
  onChange: (next: JobStatus[]) => void;
  disabled?: boolean;
  className?: string;
}) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);

  const isAllSelected =
    selected.length === 0 || selected.length === JOB_LOG_ALL_STATUSES.length;

  const summary = useMemo(() => {
    if (isAllSelected) {
      return 'All states';
    }
    if (selected.length === 1) {
      const row = OVERVIEW_STATE_ORDER.find((item) => item.status === selected[0]);
      return row?.title ?? selected[0];
    }
    return `${selected.length} states`;
  }, [isAllSelected, selected]);

  const isStatusChecked = (status: JobStatus) =>
    isAllSelected || selected.includes(status);

  const toggleStatus = (status: JobStatus) => {
    if (isAllSelected) {
      onChange(JOB_LOG_ALL_STATUSES.filter((item) => item !== status));
      return;
    }
    if (selected.includes(status)) {
      const next = selected.filter((item) => item !== status);
      onChange(next.length === 0 ? [] : next);
      return;
    }
    const next = [...selected, status];
    onChange(next.length === JOB_LOG_ALL_STATUSES.length ? [] : next);
  };

  const selectAllStatuses = () => {
    onChange([]);
  };

  return (
    <div className={cn('min-w-0', className)}>
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls={listboxId}
            className="h-10 min-h-10 w-full justify-between gap-2 px-2.5 py-1.5 font-normal sm:h-9 sm:min-h-0"
          >
            <span className="min-w-0 truncate text-left text-[11px]">{summary}</span>
            <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 opacity-60', open && 'rotate-180')} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          id={listboxId}
          align="start"
          className="w-[max(var(--radix-popover-trigger-width),12.5rem)] p-0"
          role="listbox"
          aria-multiselectable="true"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="flex flex-col">
            <div className="flex shrink-0 gap-2 border-b border-border bg-muted/40 px-2 py-1.5">
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-[10px] font-medium"
                onClick={(event) => {
                  event.stopPropagation();
                  selectAllStatuses();
                }}
              >
                All
              </Button>
            </div>
            <div
              className="min-h-0 max-h-[min(280px,45vh)] touch-pan-y overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]"
              onWheelCapture={handlePopoverListWheelCapture}
            >
              <ul className="p-1">
                {OVERVIEW_STATE_ORDER.map(({ status, title }) => {
                  const checked = isStatusChecked(status);
                  return (
                    <li key={status}>
                      <label
                        className={cn(
                          'flex w-full cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-left text-[11px] hover:bg-accent/80',
                          checked && 'bg-muted/60',
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleStatus(status)}
                          className="mt-0.5"
                          aria-label={title}
                        />
                        <span
                          className={cn(
                            'mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full',
                            JOB_STATE_STYLES[status].dot,
                          )}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">{title}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export type SearchableSingleOption = { value: string; label: string };

export function SearchableSingleSelect({
  label,
  options,
  value,
  onChange,
  placeholder = 'Select…',
  disabled,
  className,
}: {
  label: string;
  options: SearchableSingleOption[];
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const listboxId = useId();
  const searchInputReference = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [filterText, setFilterText] = useState('');

  const filteredOptions = useMemo(() => {
    const query = filterText.trim().toLowerCase();
    if (!query) {
      return options;
    }
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(query) || option.value.toLowerCase().includes(query),
    );
  }, [options, filterText]);

  useEffect(() => {
    if (!open) {
      setFilterText('');
    }
  }, [open]);

  useEffect(() => {
    if (open && options.length > 0) {
      searchInputReference.current?.focus();
    }
  }, [open, options.length]);

  const summaryLabel = useMemo(() => {
    const found = options.find((option) => option.value === value);
    return found?.label ?? placeholder;
  }, [options, value, placeholder]);

  return (
    <div className={cn('min-w-0', className)}>
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls={listboxId}
            className="h-10 min-h-10 w-full justify-between gap-2 px-2.5 py-1.5 font-normal sm:h-9 sm:min-h-0"
          >
            <span className="min-w-0 truncate text-left text-[11px]">{summaryLabel}</span>
            <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 opacity-60', open && 'rotate-180')} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          id={listboxId}
          align="start"
          className="w-[max(var(--radix-popover-trigger-width),12.5rem)] p-0"
          role="listbox"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          {options.length === 0 ? (
            <div className="px-3 py-4">
              <p className="text-[11px] leading-snug text-muted-foreground">No options available.</p>
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="shrink-0 border-b border-border px-2 py-1.5">
                <Input
                  ref={searchInputReference}
                  type="search"
                  value={filterText}
                  onChange={(event) => setFilterText(event.target.value)}
                  placeholder="Search…"
                  autoComplete="off"
                  className="h-8 font-sans text-[11px]"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                />
              </div>
              <div
                className="min-h-0 max-h-[min(280px,45vh)] touch-pan-y overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]"
                onWheelCapture={handlePopoverListWheelCapture}
              >
                <ul className="p-1">
                  {filteredOptions.length === 0 ? (
                    <li className="px-2 py-3 text-[11px] text-muted-foreground">No matches</li>
                  ) : (
                    filteredOptions.map((option) => {
                      const isSelected = option.value === value;
                      return (
                        <li key={option.value}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-[11px] hover:bg-accent/80 md:py-1.5',
                              isSelected && 'bg-muted font-medium',
                            )}
                            onClick={() => {
                              onChange(option.value);
                              setOpen(false);
                            }}
                          >
                            <span
                              className={cn(
                                'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-muted-foreground/40',
                                isSelected && 'border-foreground bg-foreground',
                              )}
                              aria-hidden
                            >
                              {isSelected ? (
                                <Check className="h-2 w-2 text-background" strokeWidth={3} />
                              ) : null}
                            </span>
                            <span className="min-w-0 flex-1 truncate">{option.label}</span>
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
