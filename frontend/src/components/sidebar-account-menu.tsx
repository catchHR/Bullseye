import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { setThemeMode, subscribeThemeMode, type ThemeMode } from '@/components/theme-toggle';
import type { BullseyeOperatorUi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ChevronsUpDown, User } from 'lucide-react';
import { useEffect, useState } from 'react';

function OperatorAvatar({
  avatarUrl,
  size,
}: {
  avatarUrl: string | null;
  size: 'trigger' | 'menu';
}) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [avatarUrl]);

  const showImage = Boolean(avatarUrl) && !imageFailed;
  const frameClass =
    size === 'trigger'
      ? 'h-9 w-9 rounded-lg'
      : 'h-8 w-8 rounded-md';

  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden border border-border bg-muted text-muted-foreground',
        frameClass,
      )}
    >
      {showImage && avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          className="h-full w-full object-cover"
          onError={() => {
            setImageFailed(true);
          }}
        />
      ) : (
        <User className="h-4 w-4" strokeWidth={1.75} aria-hidden />
      )}
    </span>
  );
}

type SidebarAccountMenuProps = {
  navCompact: boolean;
  isMobileDrawer: boolean;
  operatorUi: BullseyeOperatorUi;
};

export function SidebarAccountMenu({
  navCompact,
  isMobileDrawer,
  operatorUi,
}: SidebarAccountMenuProps) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light',
  );

  useEffect(() => subscribeThemeMode(setThemeModeState), []);

  const showLabels = !navCompact || isMobileDrawer;
  const accountAriaLabel = `Account and settings (${operatorUi.displayName})`;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-2 rounded-md text-left outline-none ring-offset-background transition-colors hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-ring',
                showLabels ? 'px-2 py-2' : 'justify-center px-0 py-1.5',
              )}
              aria-label={accountAriaLabel}
            >
              <OperatorAvatar avatarUrl={operatorUi.avatarUrl} size="trigger" />
              {showLabels ? (
                <>
                  <span className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{operatorUi.displayName}</span>
                    <span className="truncate text-xs text-muted-foreground">{operatorUi.email}</span>
                  </span>
                  <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </>
              ) : null}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side={isMobileDrawer ? 'top' : 'right'} align="end" className="max-w-[12rem] leading-snug">
          Account menu — theme and appearance
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        className="min-w-56 rounded-lg"
        side={isMobileDrawer ? 'top' : 'right'}
        align="end"
        sideOffset={4}
      >
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
            <OperatorAvatar avatarUrl={operatorUi.avatarUrl} size="menu" />
            <div className="grid min-w-0 flex-1 gap-0.5 leading-none">
              <span className="truncate font-semibold">{operatorUi.displayName}</span>
              <span className="truncate text-xs text-muted-foreground">{operatorUi.email}</span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Appearance</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-40">
            <DropdownMenuRadioGroup
              value={themeMode}
              onValueChange={(value) => {
                const next = value === 'dark' ? 'dark' : 'light';
                setThemeMode(next);
                setThemeModeState(next);
              }}
            >
              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
