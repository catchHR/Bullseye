import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';

const STORAGE_KEY = 'bull-ui-queue-list-width-px';

export const DEFAULT_QUEUE_LIST_WIDTH_PX = 280;
const MIN_QUEUE_LIST_WIDTH_PX = 200;
const MAX_QUEUE_LIST_WIDTH_PX = 560;

function clampWidth(widthPx: number): number {
  return Math.min(MAX_QUEUE_LIST_WIDTH_PX, Math.max(MIN_QUEUE_LIST_WIDTH_PX, Math.round(widthPx)));
}

function readStoredWidth(): number {
  if (typeof window === 'undefined') {
    return DEFAULT_QUEUE_LIST_WIDTH_PX;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_QUEUE_LIST_WIDTH_PX;
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) {
      return clampWidth(parsed);
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_QUEUE_LIST_WIDTH_PX;
}

export function useQueueListSidebarResize() {
  const [widthPx, setWidthPx] = useState(readStoredWidth);
  const [isResizing, setIsResizing] = useState(false);
  const latestWidthRef = useRef(widthPx);
  latestWidthRef.current = widthPx;

  const dragOriginReference = useRef({ clientX: 0, widthPx: DEFAULT_QUEUE_LIST_WIDTH_PX });

  const handleResizePointerDown = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      dragOriginReference.current = { clientX: event.clientX, widthPx };
      setIsResizing(true);
    },
    [widthPx],
  );

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const handleMove = (event: MouseEvent) => {
      const delta = event.clientX - dragOriginReference.current.clientX;
      const next = clampWidth(dragOriginReference.current.widthPx + delta);
      setWidthPx(next);
    };

    const handleUp = () => {
      setIsResizing(false);
      try {
        localStorage.setItem(STORAGE_KEY, String(latestWidthRef.current));
      } catch {
        /* ignore */
      }
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  return { widthPx, isResizing, handleResizePointerDown };
}

/** Same breakpoint as Tailwind `md` (768px). */
export function useMdUp(): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches,
  );

  useEffect(() => {
    const mediaQueryList = window.matchMedia('(min-width: 768px)');
    const handler = () => setMatches(mediaQueryList.matches);
    mediaQueryList.addEventListener('change', handler);
    return () => mediaQueryList.removeEventListener('change', handler);
  }, []);

  return matches;
}
