import type { JobStatus, JobsQueryStatus } from '@/lib/api';

export type NavView = 'overview' | 'queues' | 'schedules' | 'log' | 'alerts';

export type OverviewDashboardTab = 'workload' | 'performance';

const NAV_VIEWS: NavView[] = ['overview', 'queues', 'schedules', 'log', 'alerts'];
const OVERVIEW_TABS: OverviewDashboardTab[] = ['workload', 'performance'];

const JOB_STATUSES: JobStatus[] = [
  'waiting',
  'active',
  'delayed',
  'completed',
  'failed',
  'paused',
];

function isJobsQueryStatus(value: string): value is JobsQueryStatus {
  return value === 'all' || isJobStatus(value);
}

export type ShareableUiStateV1 = {
  v: 1;
  nav?: NavView;
  overviewTab?: OverviewDashboardTab;
  /** Selected Bull queue name */
  queue?: string | null;
  jobStatus?: JobsQueryStatus;
  jobSearch?: string;
  jobNames?: string[];
  /** Payload path → selected canonical values */
  payload?: Record<string, string[]>;
  jobLog?: {
    filter?: JobStatus | 'all';
    /** Multiple states (URL share); takes precedence over `filter` when set. */
    filters?: JobStatus[];
    offset?: number;
  };
};

function utf8ToBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToUtf8(segment: string): string {
  let base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function isJobStatus(value: string): value is JobStatus {
  return JOB_STATUSES.includes(value as JobStatus);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Parse `ui` query value into a partial state object; invalid payloads yield `null`. */
export function decodeShareableUiState(raw: string | null): Partial<ShareableUiStateV1> | null {
  if (!raw || raw.trim() === '') {
    return null;
  }
  try {
    const json = base64UrlToUtf8(raw);
    const parsed: unknown = JSON.parse(json);
    if (!isRecord(parsed)) {
      return null;
    }
    if (parsed.v !== 1) {
      return null;
    }
    const out: Partial<ShareableUiStateV1> = {};

    if (typeof parsed.nav === 'string' && NAV_VIEWS.includes(parsed.nav as NavView)) {
      out.nav = parsed.nav as NavView;
    }
    if (
      typeof parsed.overviewTab === 'string' &&
      OVERVIEW_TABS.includes(parsed.overviewTab as OverviewDashboardTab)
    ) {
      out.overviewTab = parsed.overviewTab as OverviewDashboardTab;
    }
    if (parsed.queue === null) {
      out.queue = null;
    } else if (typeof parsed.queue === 'string') {
      out.queue = parsed.queue;
    }
    if (typeof parsed.jobStatus === 'string' && isJobsQueryStatus(parsed.jobStatus)) {
      out.jobStatus = parsed.jobStatus;
    }
    if (typeof parsed.jobSearch === 'string') {
      out.jobSearch = parsed.jobSearch;
    }
    if (Array.isArray(parsed.jobNames) && parsed.jobNames.every((item) => typeof item === 'string')) {
      out.jobNames = parsed.jobNames as string[];
    }
    if (isRecord(parsed.payload)) {
      const payload: Record<string, string[]> = {};
      for (const [path, values] of Object.entries(parsed.payload)) {
        if (Array.isArray(values) && values.every((item) => typeof item === 'string')) {
          payload[path] = values;
        }
      }
      if (Object.keys(payload).length > 0) {
        out.payload = payload;
      }
    }
    if (isRecord(parsed.jobLog)) {
      const jl: ShareableUiStateV1['jobLog'] = {};
      if (Array.isArray(parsed.jobLog.filters)) {
        const filters = parsed.jobLog.filters.filter(
          (item): item is JobStatus => typeof item === 'string' && isJobStatus(item),
        );
        if (filters.length > 0) {
          jl.filters = filters;
        }
      }
      if (parsed.jobLog.filter === 'all') {
        jl.filter = 'all';
      } else if (
        typeof parsed.jobLog.filter === 'string' &&
        isJobStatus(parsed.jobLog.filter)
      ) {
        jl.filter = parsed.jobLog.filter;
      }
      if (typeof parsed.jobLog.offset === 'number' && Number.isFinite(parsed.jobLog.offset)) {
        jl.offset = Math.max(0, Math.floor(parsed.jobLog.offset));
      }
      if (jl.filter !== undefined || jl.filters !== undefined || jl.offset !== undefined) {
        out.jobLog = jl;
      }
    }

    return out;
  } catch {
    return null;
  }
}

type EncodeInput = {
  nav: NavView;
  overviewTab: OverviewDashboardTab;
  queue: string | null;
  jobStatus: JobsQueryStatus;
  jobSearch: string;
  jobNames: string[];
  payload: Record<string, string[]>;
  jobLogStatuses: JobStatus[];
  jobLogOffset: number;
};

/** Build compact `ui` param; returns `null` if nothing to store beyond defaults. */
export function encodeShareableUiState(state: EncodeInput): string | null {
  const body: ShareableUiStateV1 = { v: 1 };
  let hasExtra = false;

  if (state.nav !== 'overview') {
    body.nav = state.nav;
    hasExtra = true;
  }
  if (state.overviewTab !== 'workload') {
    body.overviewTab = state.overviewTab;
    hasExtra = true;
  }
  if (state.queue != null && state.queue !== '') {
    body.queue = state.queue;
    hasExtra = true;
  }
  if (state.jobStatus !== 'waiting') {
    body.jobStatus = state.jobStatus;
    hasExtra = true;
  }
  if (state.jobSearch.trim() !== '') {
    body.jobSearch = state.jobSearch;
    hasExtra = true;
  }
  if (state.jobNames.length > 0) {
    body.jobNames = state.jobNames;
    hasExtra = true;
  }
  if (Object.keys(state.payload).length > 0) {
    body.payload = state.payload;
    hasExtra = true;
  }
  const jobLog: NonNullable<ShareableUiStateV1['jobLog']> = {};
  const uniqueStatuses = [...new Set(state.jobLogStatuses)].filter((status) =>
    JOB_STATUSES.includes(status),
  );
  const isFullSelection =
    uniqueStatuses.length === 0 || uniqueStatuses.length === JOB_STATUSES.length;
  if (!isFullSelection) {
    if (uniqueStatuses.length === 1) {
      jobLog.filter = uniqueStatuses[0];
    } else {
      jobLog.filters = uniqueStatuses;
    }
  }
  if (state.jobLogOffset > 0) {
    jobLog.offset = state.jobLogOffset;
  }
  if (jobLog.filter !== undefined || jobLog.filters !== undefined || jobLog.offset !== undefined) {
    body.jobLog = jobLog;
    hasExtra = true;
  }

  if (!hasExtra) {
    return null;
  }

  return utf8ToBase64Url(JSON.stringify(body));
}

export const UI_QUERY_PARAM = 'ui';

export function readUiParamFromLocation(): Partial<ShareableUiStateV1> | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return decodeShareableUiState(new URLSearchParams(window.location.search).get(UI_QUERY_PARAM));
}

function applyUiParamToUrl(encoded: string | null, mode: 'push' | 'replace'): void {
  if (typeof window === 'undefined') {
    return;
  }
  const url = new URL(window.location.href);
  if (encoded != null && encoded.length > 0) {
    url.searchParams.set(UI_QUERY_PARAM, encoded);
  } else {
    url.searchParams.delete(UI_QUERY_PARAM);
  }
  const state = window.history.state;
  if (mode === 'push') {
    window.history.pushState(state, '', url.toString());
  } else {
    window.history.replaceState(state, '', url.toString());
  }
}

/** Updates the URL without adding a history entry (replace current entry). */
export function replaceUrlWithUiState(encoded: string | null): void {
  applyUiParamToUrl(encoded, 'replace');
}

/** Push a browser history entry so Back/Forward restores UI state (same tab, same path). */
export function pushUrlWithUiState(encoded: string | null): void {
  applyUiParamToUrl(encoded, 'push');
}

/** Raw `ui` query value on the current location (compare before push/replace). */
export function readUiQueryParamRaw(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  return new URLSearchParams(window.location.search).get(UI_QUERY_PARAM) ?? '';
}

/** Empty array = all states (same as legacy `filter: 'all'`). */
export function jobLogStatusesFromShareable(
  jobLog: ShareableUiStateV1['jobLog'] | undefined,
): JobStatus[] {
  if (!jobLog) {
    return [];
  }
  if (jobLog.filters != null && jobLog.filters.length > 0) {
    return jobLog.filters.filter((status): status is JobStatus => isJobStatus(status));
  }
  if (jobLog.filter && jobLog.filter !== 'all') {
    return [jobLog.filter];
  }
  return [];
}
