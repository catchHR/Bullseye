import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export function SimpleModal({
  open,
  title,
  children,
  onClose,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  /** Wider panel for payload grid */
  wide?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        className={cn(
          'flex max-h-[min(88vh,720px)] flex-col gap-0 overflow-hidden p-0 sm:rounded-xl',
          wide ? 'max-w-3xl' : 'max-w-md',
        )}
      >
        <DialogHeader className="shrink-0 space-y-0 border-b border-border px-4 py-3 pr-12 text-left">
          <DialogTitle className="text-sm font-semibold tracking-tight">{title}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-3">{children}</div>
        {footer ? (
          <DialogFooter className="shrink-0 border-t border-border px-4 py-3 sm:justify-end">
            {footer}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
