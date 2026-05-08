import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { emptyQueue, pauseQueue, resumeQueue } from '@/lib/api';
import { toast } from '@/lib/bullseye-toast';
import { cn } from '@/lib/utils';
import { ListPlus, MoreVertical, Pause, Play, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';

export function QueueActionsMenu({
  queueName,
  isPaused,
  triggerClassName,
  onAfterChange,
  onAddJob,
}: {
  queueName: string;
  isPaused: boolean;
  /** Wider hit target in the sidebar row vs compact header. */
  triggerClassName?: string;
  onAfterChange: () => Promise<void> | void;
  /** Opens the enqueue modal for this queue (selects queue if needed). */
  onAddJob?: (queueName: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [emptyQueueConfirmOpen, setEmptyQueueConfirmOpen] = useState(false);
  const [emptyQueueInProgress, setEmptyQueueInProgress] = useState(false);

  const runAfter = useCallback(async () => {
    await onAfterChange();
  }, [onAfterChange]);

  const handlePause = useCallback(async () => {
    try {
      await pauseQueue(queueName);
      toast.success(`Queue paused: ${queueName}`);
      setMenuOpen(false);
      await runAfter();
    } catch (errorUnknown) {
      toast.error(errorUnknown instanceof Error ? errorUnknown.message : 'Pause failed.');
    }
  }, [queueName, runAfter]);

  const handleResume = useCallback(async () => {
    try {
      await resumeQueue(queueName);
      toast.success(`Queue resumed: ${queueName}`);
      setMenuOpen(false);
      await runAfter();
    } catch (errorUnknown) {
      toast.error(errorUnknown instanceof Error ? errorUnknown.message : 'Resume failed.');
    }
  }, [queueName, runAfter]);

  const handleConfirmEmptyQueue = useCallback(async () => {
    setEmptyQueueInProgress(true);
    try {
      await emptyQueue(queueName);
      toast.success(`Waiting & delayed cleared: ${queueName}`);
      setMenuOpen(false);
      await runAfter();
      setEmptyQueueConfirmOpen(false);
    } catch (errorUnknown) {
      toast.error(errorUnknown instanceof Error ? errorUnknown.message : 'Clear failed.');
    } finally {
      setEmptyQueueInProgress(false);
    }
  }, [queueName, runAfter]);

  const handleAddJob = useCallback(() => {
    onAddJob?.(queueName);
    setMenuOpen(false);
  }, [onAddJob, queueName]);

  return (
    <>
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'shrink-0 text-muted-foreground hover:text-foreground',
            triggerClassName ?? 'h-8 w-8',
          )}
          aria-label={`Queue actions: ${queueName}`}
          title="Add job, pause, resume, or clear queue"
          onClick={(event) => event.stopPropagation()}
        >
          <MoreVertical className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[80] min-w-44">
        {onAddJob ? (
          <DropdownMenuItem className="gap-2 text-xs" onSelect={() => handleAddJob()}>
            <ListPlus className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
            Add job…
          </DropdownMenuItem>
        ) : null}
        {onAddJob ? <DropdownMenuSeparator /> : null}
        {isPaused ? (
          <DropdownMenuItem className="gap-2 text-xs" onSelect={() => void handleResume()}>
            <Play className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
            Resume queue
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem className="gap-2 text-xs" onSelect={() => void handlePause()}>
            <Pause className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
            Pause queue
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2 text-xs text-destructive focus:text-destructive"
          onSelect={() => setEmptyQueueConfirmOpen(true)}
        >
          <Trash2 className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
          Clear waiting & delayed…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <AlertDialog
      open={emptyQueueConfirmOpen}
      onOpenChange={(isOpen) => {
        if (!isOpen && !emptyQueueInProgress) {
          setEmptyQueueConfirmOpen(false);
        }
      }}
    >
      <AlertDialogContent className="gap-4">
        <AlertDialogHeader>
          <AlertDialogTitle>Clear waiting and delayed jobs?</AlertDialogTitle>
          <AlertDialogDescription>
            Remove all waiting and delayed jobs from{' '}
            <span className="font-mono text-foreground">{queueName}</span>. Active, completed, and
            failed jobs are not removed. Repeatable schedules stay.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={emptyQueueInProgress}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={emptyQueueInProgress}
            onClick={() => void handleConfirmEmptyQueue()}
          >
            {emptyQueueInProgress ? 'Clearing…' : 'Clear queue slice'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
