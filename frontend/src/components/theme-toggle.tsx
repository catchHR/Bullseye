import { useEffect, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type ThemeMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'bull-mq-ui-theme';

/** Apply stored theme (or system preference if unset) before React mounts to avoid flash. */
export function applyThemeFromStorage(): void {
  if (typeof document === 'undefined') {
    return;
  }
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  const prefersDark =
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const useDark = stored ? stored === 'dark' : prefersDark;
  document.documentElement.classList.toggle('dark', useDark);
}

export function readThemeModeFromDom(): ThemeMode {
  if (typeof document === 'undefined') {
    return 'light';
  }
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function setThemeMode(mode: ThemeMode): void {
  if (typeof document === 'undefined') {
    return;
  }
  localStorage.setItem(THEME_STORAGE_KEY, mode === 'dark' ? 'dark' : 'light');
  document.documentElement.classList.toggle('dark', mode === 'dark');
}

/** Theme updates from the same tab (MutationObserver) and other tabs (`storage`). */
export function subscribeThemeMode(listener: (mode: ThemeMode) => void): () => void {
  listener(readThemeModeFromDom());
  const observer = new MutationObserver(() => {
    listener(readThemeModeFromDom());
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) {
      listener(readThemeModeFromDom());
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    observer.disconnect();
    window.removeEventListener('storage', onStorage);
  };
}

export function ThemeSelect({ compact }: { compact?: boolean }) {
  const [mode, setMode] = useState<ThemeMode>(() => readThemeModeFromDom());

  useEffect(() => {
    const readAndApply = () => {
      applyThemeFromStorage();
      setMode(readThemeModeFromDom());
    };

    readAndApply();

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const onPrefersChange = () => {
      if (localStorage.getItem(THEME_STORAGE_KEY) == null) {
        readAndApply();
      }
    };
    mediaQuery.addEventListener('change', onPrefersChange);

    const unsubscribe = subscribeThemeMode(setMode);

    return () => {
      mediaQuery.removeEventListener('change', onPrefersChange);
      unsubscribe();
    };
  }, []);

  const onValueChange = (value: string) => {
    const next = value === 'dark' ? 'dark' : 'light';
    setMode(next);
    setThemeMode(next);
  };

  return (
    <Select value={mode} onValueChange={onValueChange}>
      <SelectTrigger
        aria-label="Color theme"
        className={cn(
          'w-[4.5rem] shrink-0 shadow-sm tabular-nums',
          compact ? 'h-8 px-2 text-[10px]' : 'h-9 px-2 text-xs',
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" side="top" align="end" className="z-[80]">
        <SelectItem value="light">Light</SelectItem>
        <SelectItem value="dark">Dark</SelectItem>
      </SelectContent>
    </Select>
  );
}
