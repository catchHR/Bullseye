import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  OctagonAlert,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { subscribeThemeMode, type ThemeMode } from '@/components/theme-toggle';

/** Matches shadcn new-york Sonner ([docs](https://ui.shadcn.com/docs/components/radix/sonner)); theme follows `document.documentElement` (no next-themes). */
export function Toaster({ ...props }: ToasterProps) {
  const [theme, setTheme] = useState<ThemeMode>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light',
  );

  useEffect(() => subscribeThemeMode(setTheme), []);

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CheckCircle2 className="size-4" strokeWidth={2} aria-hidden />,
        info: <Info className="size-4" strokeWidth={2} aria-hidden />,
        warning: <AlertTriangle className="size-4" strokeWidth={2} aria-hidden />,
        error: <OctagonAlert className="size-4" strokeWidth={2} aria-hidden />,
        loading: <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />,
      }}
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:border-border group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:shadow-lg',
          title: 'group-[.toast]:text-foreground',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      style={
        {
          '--normal-bg': 'hsl(var(--popover))',
          '--normal-text': 'hsl(var(--popover-foreground))',
          '--normal-border': 'hsl(var(--border))',
          '--border-radius': 'var(--radius)',
        } as CSSProperties
      }
      {...props}
    />
  );
}
