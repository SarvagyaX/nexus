import type {
  Playbook,
  PlaybookCreate,
  PlaybookExecution,
  PlaybookExecutionListResponse,
  PlaybookExecutionStatus,
  PlaybookListResponse,
  PlaybookStatus,
  PlaybookTemplate,
  PlaybookTriggerType,
  PlaybookUpdate,
} from './types';

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '');

export class PlaybookApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string = 'request_failed') {
    super(message);
    this.name = 'PlaybookApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}, csrfToken?: string | null): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken);

  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, { ...init, headers, credentials: 'include' });
  } catch {
    throw new PlaybookApiError(
      'NEXUS could not reach the playbook engine. Check your connection.',
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
      (payload as { detail?: string | { message?: string } })?.detail?.toString() ??
      `Request failed with status ${response.status}`;
    const code = errorBody?.error?.code ?? 'request_failed';
    throw new PlaybookApiError(message, response.status, code);
  }

  return payload as T;
}

export const playbooksApi = {
  // Playbooks CRUD
  async listPlaybooks(
    workspaceId: string,
    params: {
      status?: PlaybookStatus;
      trigger_type?: PlaybookTriggerType;
      category?: string;
      search?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<PlaybookListResponse> {
    const search = new URLSearchParams();
    if (params.status) search.set('status', params.status);
    if (params.trigger_type) search.set('trigger_type', params.trigger_type);
    if (params.category) search.set('category', params.category);
    if (params.search) search.set('search', params.search);
    if (params.limit) search.set('limit', String(params.limit));
    if (params.offset) search.set('offset', String(params.offset));

    const qs = search.toString();
    const endpoint = `/api/v1/workspaces/${workspaceId}/playbooks${qs ? `?${qs}` : ''}`;
    return request<PlaybookListResponse>(endpoint);
  },

  async getPlaybook(workspaceId: string, playbookId: string): Promise<Playbook> {
    return request<Playbook>(`/api/v1/workspaces/${workspaceId}/playbooks/${playbookId}`);
  },

  async createPlaybook(
    workspaceId: string,
    payload: PlaybookCreate,
    csrfToken?: string | null
  ): Promise<Playbook> {
    return request<Playbook>(
      `/api/v1/workspaces/${workspaceId}/playbooks`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      csrfToken
    );
  },

  async updatePlaybook(
    workspaceId: string,
    playbookId: string,
    payload: PlaybookUpdate,
    csrfToken?: string | null
  ): Promise<Playbook> {
    return request<Playbook>(
      `/api/v1/workspaces/${workspaceId}/playbooks/${playbookId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
      csrfToken
    );
  },

  async duplicatePlaybook(
    workspaceId: string,
    playbookId: string,
    csrfToken?: string | null
  ): Promise<Playbook> {
    return request<Playbook>(
      `/api/v1/workspaces/${workspaceId}/playbooks/${playbookId}/duplicate`,
      {
        method: 'POST',
      },
      csrfToken
    );
  },

  async archivePlaybook(
    workspaceId: string,
    playbookId: string,
    csrfToken?: string | null
  ): Promise<Playbook> {
    return request<Playbook>(
      `/api/v1/workspaces/${workspaceId}/playbooks/${playbookId}/archive`,
      {
        method: 'POST',
      },
      csrfToken
    );
  },

  async deletePlaybook(
    workspaceId: string,
    playbookId: string,
    csrfToken?: string | null
  ): Promise<void> {
    return request<void>(
      `/api/v1/workspaces/${workspaceId}/playbooks/${playbookId}`,
      {
        method: 'DELETE',
      },
      csrfToken
    );
  },

  // Templates
  async getTemplates(workspaceId: string): Promise<PlaybookTemplate[]> {
    return request<PlaybookTemplate[]>(`/api/v1/workspaces/${workspaceId}/playbooks/templates`);
  },

  async instantiateTemplate(
    workspaceId: string,
    templateId: string,
    csrfToken?: string | null
  ): Promise<Playbook> {
    return request<Playbook>(
      `/api/v1/workspaces/${workspaceId}/playbooks/templates/${templateId}/instantiate`,
      {
        method: 'POST',
      },
      csrfToken
    );
  },

  // Executions
  async executePlaybook(
    workspaceId: string,
    playbookId: string,
    payload: {
      incident_id?: string;
      alert_id?: string;
      context?: Record<string, any>;
    } = {},
    csrfToken?: string | null
  ): Promise<PlaybookExecution> {
    return request<PlaybookExecution>(
      `/api/v1/workspaces/${workspaceId}/playbooks/${playbookId}/execute`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      csrfToken
    );
  },

  async listExecutions(
    workspaceId: string,
    params: {
      playbook_id?: string;
      status?: PlaybookExecutionStatus;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<PlaybookExecutionListResponse> {
    const search = new URLSearchParams();
    if (params.playbook_id) search.set('playbook_id', params.playbook_id);
    if (params.status) search.set('status', params.status);
    if (params.limit) search.set('limit', String(params.limit));
    if (params.offset) search.set('offset', String(params.offset));

    const qs = search.toString();
    const endpoint = `/api/v1/workspaces/${workspaceId}/playbook-executions${qs ? `?${qs}` : ''}`;
    return request<PlaybookExecutionListResponse>(endpoint);
  },

  async getExecution(workspaceId: string, executionId: string): Promise<PlaybookExecution> {
    return request<PlaybookExecution>(
      `/api/v1/workspaces/${workspaceId}/playbook-executions/${executionId}`
    );
  },

  async approveStep(
    workspaceId: string,
    executionId: string,
    comment?: string,
    csrfToken?: string | null
  ): Promise<PlaybookExecution> {
    return request<PlaybookExecution>(
      `/api/v1/workspaces/${workspaceId}/playbook-executions/${executionId}/approve`,
      {
        method: 'POST',
        body: JSON.stringify({ comment }),
      },
      csrfToken
    );
  },

  async rejectStep(
    workspaceId: string,
    executionId: string,
    comment?: string,
    csrfToken?: string | null
  ): Promise<PlaybookExecution> {
    return request<PlaybookExecution>(
      `/api/v1/workspaces/${workspaceId}/playbook-executions/${executionId}/reject`,
      {
        method: 'POST',
        body: JSON.stringify({ comment }),
      },
      csrfToken
    );
  },

  async cancelExecution(
    workspaceId: string,
    executionId: string,
    csrfToken?: string | null
  ): Promise<PlaybookExecution> {
    return request<PlaybookExecution>(
      `/api/v1/workspaces/${workspaceId}/playbook-executions/${executionId}/cancel`,
      {
        method: 'POST',
      },
      csrfToken
    );
  },
};
