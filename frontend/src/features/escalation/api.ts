import type {
  EscalationExecution,
  EscalationExecutionStatus,
  EscalationPolicy,
  EscalationPolicyCreate,
  EscalationPolicyUpdate,
} from './types';

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '');

export class EscalationApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string = 'request_failed') {
    super(message);
    this.name = 'EscalationApiError';
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
    throw new EscalationApiError(
      'NEXUS could not reach the escalation policy service. Check your connection.',
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
          ? 'You do not have permission to manage escalation policies.'
          : response.status === 404
            ? 'The requested escalation resource was not found.'
            : 'The escalation policy request could not be completed.');
    const code = errorBody?.error?.code ?? (response.status === 0 ? 'network_error' : 'request_failed');
    throw new EscalationApiError(message, response.status, code);
  }

  return payload as T;
}

export const escalationApi = {
  async listPolicies(workspaceId: string): Promise<EscalationPolicy[]> {
    return request<EscalationPolicy[]>(`/api/v1/workspaces/${workspaceId}/escalation/policies`);
  },

  async getPolicy(workspaceId: string, policyId: string): Promise<EscalationPolicy> {
    return request<EscalationPolicy>(`/api/v1/workspaces/${workspaceId}/escalation/policies/${policyId}`);
  },

  async createPolicy(
    workspaceId: string,
    payload: EscalationPolicyCreate,
    csrfToken?: string
  ): Promise<EscalationPolicy> {
    return request<EscalationPolicy>(
      `/api/v1/workspaces/${workspaceId}/escalation/policies`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      csrfToken
    );
  },

  async updatePolicy(
    workspaceId: string,
    policyId: string,
    payload: EscalationPolicyUpdate,
    csrfToken?: string
  ): Promise<EscalationPolicy> {
    return request<EscalationPolicy>(
      `/api/v1/workspaces/${workspaceId}/escalation/policies/${policyId}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      csrfToken
    );
  },

  async deletePolicy(workspaceId: string, policyId: string, csrfToken?: string): Promise<void> {
    return request<void>(
      `/api/v1/workspaces/${workspaceId}/escalation/policies/${policyId}`,
      {
        method: 'DELETE',
      },
      csrfToken
    );
  },

  async listExecutions(
    workspaceId: string,
    status?: EscalationExecutionStatus,
    limit: number = 50
  ): Promise<EscalationExecution[]> {
    const search = new URLSearchParams();
    if (status) search.set('status', status);
    search.set('limit', String(limit));
    const qs = search.toString();
    return request<EscalationExecution[]>(
      `/api/v1/workspaces/${workspaceId}/escalation/executions${qs ? `?${qs}` : ''}`
    );
  },

  async processDue(workspaceId: string, csrfToken?: string): Promise<EscalationExecution[]> {
    return request<EscalationExecution[]>(
      `/api/v1/workspaces/${workspaceId}/escalation/process-due`,
      {
        method: 'POST',
      },
      csrfToken
    );
  },
};
