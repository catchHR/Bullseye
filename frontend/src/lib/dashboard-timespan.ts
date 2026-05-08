export type DashboardTimespanId = '30m' | '1h' | '6h' | '24h' | '7d' | '30d' | 'all';

const STORAGE_KEY = 'bullseye-dashboard-timespan-id';

const ALL_IDS: DashboardTimespanId[] = ['30m', '1h', '6h', '24h', '7d', '30d', 'all'];

export const DASHBOARD_TIMESPAN_OPTIONS: {
  id: DashboardTimespanId;
  label: string;
  /** `null` = no lower time bound (full session / sample window) */
  durationMs: number | null;
}[] = [
  { id: '30m', label: 'Last 30 min', durationMs: 30 * 60 * 1000 },
  { id: '1h', label: 'Last hour', durationMs: 60 * 60 * 1000 },
  { id: '6h', label: 'Last 6 hours', durationMs: 6 * 60 * 60 * 1000 },
  { id: '24h', label: 'Last 24 hours', durationMs: 24 * 60 * 60 * 1000 },
  { id: '7d', label: 'Last 7 days', durationMs: 7 * 24 * 60 * 60 * 1000 },
  { id: '30d', label: 'Last 30 days', durationMs: 30 * 24 * 60 * 60 * 1000 },
  { id: 'all', label: 'All time', durationMs: null },
];

export function readStoredDashboardTimespanId(): DashboardTimespanId {
  if (typeof window === 'undefined') {
    return 'all';
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw && ALL_IDS.includes(raw as DashboardTimespanId)) {
    return raw as DashboardTimespanId;
  }
  return 'all';
}

export function writeStoredDashboardTimespanId(id: DashboardTimespanId): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, id);
}

export function dashboardTimespanDurationMs(id: DashboardTimespanId): number | null {
  const row = DASHBOARD_TIMESPAN_OPTIONS.find((option) => option.id === id);
  return row?.durationMs ?? null;
}
