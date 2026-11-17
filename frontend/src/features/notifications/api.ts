import type {
  NotificationItem,
  NotificationListResponse,
  NotificationPreference,
  NotificationPreferenceUpdate,
  NotificationProvidersStatusResponse,
  TestWebhookResponse,
  UnreadCountResponse,
} from './types';

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '');

export class NotificationApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string = 'request_failed') {
    super(message);
    this.name = 'NotificationApiError';
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
    throw new NotificationApiError(
      'NEXUS could not reach the notification service. Check your connection.',
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
          ? 'You do not have permission to perform this notification action.'
          : response.status === 404
            ? 'The requested notification resource was not found.'
            : 'The notification request could not be completed.');
    const code = errorBody?.error?.code ?? (response.status === 0 ? 'network_error' : 'request_failed');
    throw new NotificationApiError(message, response.status, code);
  }

  return payload as T;
}

export interface ListNotificationParams {
  category?: string;
  is_read?: boolean;
  cursor?: string;
  limit?: number;
}

export const notificationsApi = {
  async list(workspaceId: string, params: ListNotificationParams = {}): Promise<NotificationListResponse> {
    const search = new URLSearchParams();
    if (params.category) search.set('category', params.category);
    if (params.is_read !== undefined) search.set('is_read', String(params.is_read));
    if (params.cursor) search.set('cursor', params.cursor);
    if (params.limit) search.set('limit', String(params.limit));

    const qs = search.toString();
    return request<NotificationListResponse>(
      `/api/v1/workspaces/${workspaceId}/notifications${qs ? `?${qs}` : ''}`
    );
  },

  async getUnreadCount(workspaceId: string): Promise<number> {
    const res = await request<UnreadCountResponse>(
      `/api/v1/workspaces/${workspaceId}/notifications/unread-count`
    );
    return res.unread_count;
  },

  async markRead(workspaceId: string, notificationId: string, csrfToken?: string): Promise<NotificationItem> {
    return request<NotificationItem>(
      `/api/v1/workspaces/${workspaceId}/notifications/${notificationId}/read`,
      { method: 'POST' },
      csrfToken
    );
  },

  async markAllRead(
    workspaceId: string,
    notificationIds?: string[],
    csrfToken?: string
  ): Promise<{ marked_read: number }> {
    return request<{ marked_read: number }>(
      `/api/v1/workspaces/${workspaceId}/notifications/read-all`,
      {
        method: 'POST',
        body: JSON.stringify({ notification_ids: notificationIds }),
      },
      csrfToken
    );
  },

  async getPreferences(workspaceId: string): Promise<NotificationPreference> {
    return request<NotificationPreference>(
      `/api/v1/workspaces/${workspaceId}/notifications/preferences`
    );
  },

  async updatePreferences(
    workspaceId: string,
    payload: NotificationPreferenceUpdate,
    csrfToken?: string
  ): Promise<NotificationPreference> {
    return request<NotificationPreference>(
      `/api/v1/workspaces/${workspaceId}/notifications/preferences`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      csrfToken
    );
  },

  async getProvidersStatus(workspaceId: string): Promise<NotificationProvidersStatusResponse> {
    return request<NotificationProvidersStatusResponse>(
      `/api/v1/workspaces/${workspaceId}/notifications/providers/status`
    );
  },

  async testWebhook(
    workspaceId: string,
    webhookUrl: string,
    csrfToken?: string
  ): Promise<TestWebhookResponse> {
    return request<TestWebhookResponse>(
      `/api/v1/workspaces/${workspaceId}/notifications/test-webhook`,
      {
        method: 'POST',
        body: JSON.stringify({ webhook_url: webhookUrl }),
      },
      csrfToken
    );
  },
};
