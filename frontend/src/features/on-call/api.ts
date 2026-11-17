import type {
  CurrentOnCallResponse,
  OnCallSchedule,
  OnCallScheduleCreate,
  OnCallScheduleUpdate,
} from './types';

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '');

export class OnCallApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string = 'request_failed') {
    super(message);
    this.name = 'OnCallApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}, csrfToken?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken);

  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, { ...init, headers, credentials: 'include' });
  } catch {
    throw new OnCallApiError(
      'NEXUS could not reach the on-call schedule service. Check your connection.',
      0,
      'network_error'
    );
  }

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? ((await response.json()) as unknown) : null;

  if (!response.ok) {
    const errorBody = payload as { error?: { message?: string; code?: string } } | null;
    const message =
      errorBody?.error?.message ??
      (response.status === 401
        ? 'Your session has expired. Sign in again.'
        : response.status === 403
          ? 'You do not have permission to manage on-call schedules.'
          : response.status === 404
            ? 'The requested schedule was not found.'
            : 'The on-call schedule request could not be completed.');
    const code = errorBody?.error?.code ?? (response.status === 0 ? 'network_error' : 'request_failed');
    throw new OnCallApiError(message, response.status, code);
  }

  return payload as T;
}

export const onCallApi = {
  async list(workspaceId: string): Promise<OnCallSchedule[]> {
    return request<OnCallSchedule[]>(`/api/v1/workspaces/${workspaceId}/on-call/schedules`);
  },

  async get(workspaceId: string, scheduleId: string): Promise<OnCallSchedule> {
    return request<OnCallSchedule>(`/api/v1/workspaces/${workspaceId}/on-call/schedules/${scheduleId}`);
  },

  async create(workspaceId: string, payload: OnCallScheduleCreate, csrfToken?: string): Promise<OnCallSchedule> {
    return request<OnCallSchedule>(
      `/api/v1/workspaces/${workspaceId}/on-call/schedules`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      csrfToken
    );
  },

  async update(
    workspaceId: string,
    scheduleId: string,
    payload: OnCallScheduleUpdate,
    csrfToken?: string
  ): Promise<OnCallSchedule> {
    return request<OnCallSchedule>(
      `/api/v1/workspaces/${workspaceId}/on-call/schedules/${scheduleId}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      csrfToken
    );
  },

  async delete(workspaceId: string, scheduleId: string, csrfToken?: string): Promise<void> {
    return request<void>(
      `/api/v1/workspaces/${workspaceId}/on-call/schedules/${scheduleId}`,
      {
        method: 'DELETE',
      },
      csrfToken
    );
  },

  async getCurrent(workspaceId: string, scheduleId: string): Promise<CurrentOnCallResponse> {
    return request<CurrentOnCallResponse>(
      `/api/v1/workspaces/${workspaceId}/on-call/schedules/${scheduleId}/current`
    );
  },
};
