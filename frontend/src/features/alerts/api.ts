import type {
  AlertDetail,
  AlertEvaluationResult,
  AlertGroupListResponse,
  AlertListResponse,
  AlertRule,
  AlertRuleCreate,
  AlertRuleListResponse,
  AlertRulePatch,
  AlertSeverity,
  AlertStats,
  AlertStatus,
  AlertSummary,
} from './types';

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '');

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: Array<{ field?: string; reason?: string }>;
  };
};

export class AlertApiError extends Error {
  status: number;
  code: string;
  details: Array<{ field?: string; reason?: string }>;

  constructor(
    message: string,
    status: number,
    code: string,
    details: Array<{ field?: string; reason?: string }> = []
  ) {
    super(message);
    this.name = 'AlertApiError';
    this.status = status;
    this.code = code;
    this.details = details;
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
    throw new AlertApiError(
      'NEXUS could not reach the alerting service. Check your connection and retry.',
      0,
      'network_error'
    );
  }

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? ((await response.json()) as unknown) : null;

  if (!response.ok) {
    const errorBody = payload as ApiErrorBody | null;
    const message =
      errorBody?.error?.message ??
      (response.status === 401
        ? 'Your session has expired. Sign in again.'
        : response.status === 403
          ? 'You do not have permission to perform this action.'
          : response.status === 404
            ? 'The requested alert resource was not found.'
            : 'The alert request could not be completed.');
    const code = errorBody?.error?.code ?? (response.status === 0 ? 'network_error' : 'request_failed');
    const details = errorBody?.error?.details ?? [];
    throw new AlertApiError(message, response.status, code, details);
  }

  return payload as T;
}

export interface AlertListParams {
  status?: AlertStatus;
  severity?: AlertSeverity;
  service_id?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

export const alertsApi = {
  // Alert Queries
  list(workspaceId: string, params: AlertListParams = {}): Promise<AlertListResponse> {
    const search = new URLSearchParams();
    if (params.status) search.set('status', params.status);
    if (params.severity) search.set('severity', params.severity);
    if (params.service_id) search.set('service_id', params.service_id);
    if (params.q) search.set('q', params.q);
    if (params.cursor) search.set('cursor', params.cursor);
    if (typeof params.limit === 'number') search.set('limit', String(params.limit));

    const query = search.toString();
    return request<AlertListResponse>(
      `/api/v1/workspaces/${workspaceId}/alerts${query ? `?${query}` : ''}`
    );
  },

  get(workspaceId: string, alertId: string): Promise<AlertDetail> {
    return request<AlertDetail>(`/api/v1/workspaces/${workspaceId}/alerts/${alertId}`);
  },

  stats(workspaceId: string): Promise<AlertStats> {
    return request<AlertStats>(`/api/v1/workspaces/${workspaceId}/alerts/stats`);
  },

  groups(workspaceId: string): Promise<AlertGroupListResponse> {
    return request<AlertGroupListResponse>(`/api/v1/workspaces/${workspaceId}/alerts/groups`);
  },

  // Manual Rule Evaluation Trigger
  evaluate(
    workspaceId: string,
    serviceId?: string,
    csrfToken?: string
  ): Promise<AlertEvaluationResult> {
    const query = serviceId ? `?service_id=${serviceId}` : '';
    return request<AlertEvaluationResult>(
      `/api/v1/workspaces/${workspaceId}/alerts/evaluate${query}`,
      { method: 'POST' },
      csrfToken
    );
  },

  // Alert Lifecycle Actions
  acknowledge(workspaceId: string, alertId: string, csrfToken: string): Promise<AlertDetail> {
    return request<AlertDetail>(
      `/api/v1/workspaces/${workspaceId}/alerts/${alertId}/acknowledge`,
      { method: 'POST' },
      csrfToken
    );
  },

  snooze(
    workspaceId: string,
    alertId: string,
    durationMinutes: number,
    csrfToken: string
  ): Promise<AlertDetail> {
    return request<AlertDetail>(
      `/api/v1/workspaces/${workspaceId}/alerts/${alertId}/snooze`,
      {
        method: 'POST',
        body: JSON.stringify({ duration_minutes: durationMinutes }),
      },
      csrfToken
    );
  },

  resolve(
    workspaceId: string,
    alertId: string,
    resolutionNote: string | undefined,
    csrfToken: string
  ): Promise<AlertDetail> {
    return request<AlertDetail>(
      `/api/v1/workspaces/${workspaceId}/alerts/${alertId}/resolve`,
      {
        method: 'POST',
        body: JSON.stringify({ resolution_note: resolutionNote || undefined }),
      },
      csrfToken
    );
  },

  reopen(workspaceId: string, alertId: string, csrfToken: string): Promise<AlertDetail> {
    return request<AlertDetail>(
      `/api/v1/workspaces/${workspaceId}/alerts/${alertId}/reopen`,
      { method: 'POST' },
      csrfToken
    );
  },

  // Incident Escalation
  createIncident(
    workspaceId: string,
    alertId: string,
    payload: { title?: string; severity?: AlertSeverity } = {},
    csrfToken: string
  ): Promise<AlertDetail> {
    return request<AlertDetail>(
      `/api/v1/workspaces/${workspaceId}/alerts/${alertId}/create-incident`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      csrfToken
    );
  },

  linkIncident(
    workspaceId: string,
    alertId: string,
    incidentId: string,
    csrfToken: string
  ): Promise<AlertDetail> {
    return request<AlertDetail>(
      `/api/v1/workspaces/${workspaceId}/alerts/${alertId}/link-incident`,
      {
        method: 'POST',
        body: JSON.stringify({ incident_id: incidentId }),
      },
      csrfToken
    );
  },

  // Alert Rules Management
  getRules(workspaceId: string): Promise<AlertRuleListResponse> {
    return request<AlertRuleListResponse>(`/api/v1/workspaces/${workspaceId}/alerts/rules`);
  },

  getRule(workspaceId: string, ruleId: string): Promise<AlertRule> {
    return request<AlertRule>(`/api/v1/workspaces/${workspaceId}/alerts/rules/${ruleId}`);
  },

  createRule(
    workspaceId: string,
    payload: AlertRuleCreate,
    csrfToken: string
  ): Promise<AlertRule> {
    return request<AlertRule>(
      `/api/v1/workspaces/${workspaceId}/alerts/rules`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      csrfToken
    );
  },

  patchRule(
    workspaceId: string,
    ruleId: string,
    payload: AlertRulePatch,
    csrfToken: string
  ): Promise<AlertRule> {
    return request<AlertRule>(
      `/api/v1/workspaces/${workspaceId}/alerts/rules/${ruleId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
      csrfToken
    );
  },

  deleteRule(workspaceId: string, ruleId: string, csrfToken: string): Promise<void> {
    return request<void>(
      `/api/v1/workspaces/${workspaceId}/alerts/rules/${ruleId}`,
      { method: 'DELETE' },
      csrfToken
    );
  },
};

/**
 * Creates a Server-Sent Events (SSE) connection to receive real-time alerts.
 * Automatically handles reconnection and parses messages.
 */
export function subscribeAlertStream(
  workspaceId: string,
  onEvent: (event: { event: string; alert?: AlertSummary; data?: any }) => void,
  onError?: (error: Event) => void
): () => void {
  const url = `${apiBase}/api/v1/workspaces/${workspaceId}/alerts/stream`;
  const eventSource = new EventSource(url, { withCredentials: true });

  eventSource.addEventListener('alert.created', (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      onEvent({ event: 'alert.created', ...data });
    } catch {
      // Ignored
    }
  });

  eventSource.addEventListener('alert.updated', (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      onEvent({ event: 'alert.updated', ...data });
    } catch {
      // Ignored
    }
  });

  eventSource.addEventListener('alert.status_changed', (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      onEvent({ event: 'alert.status_changed', ...data });
    } catch {
      // Ignored
    }
  });

  eventSource.addEventListener('alert.incident_created', (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      onEvent({ event: 'alert.incident_created', ...data });
    } catch {
      // Ignored
    }
  });

  if (onError) {
    eventSource.onerror = (err) => {
      onError(err);
    };
  }

  return () => {
    eventSource.close();
  };
}
