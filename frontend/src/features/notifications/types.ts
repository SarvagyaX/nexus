export type NotificationCategory = 'alert' | 'incident' | 'investigation' | 'system';

export type NotificationDeliveryChannel = 'in_app' | 'email' | 'webhook';

export type NotificationDeliveryStatus = 'pending' | 'sent' | 'failed';

export interface NotificationItem {
  id: string;
  workspace_id: string;
  user_id: string;
  category: NotificationCategory;
  severity: string;
  title: string;
  message: string;
  link?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  is_read: boolean;
  read_at?: string | null;
  created_at: string;
}

export interface NotificationListResponse {
  items: NotificationItem[];
  total_unread: number;
  next_cursor?: string | null;
}

export interface UnreadCountResponse {
  unread_count: number;
}

export interface NotificationPreference {
  id: string;
  workspace_id: string;
  user_id: string;
  alerts_enabled: boolean;
  alerts_min_severity: string;
  incidents_enabled: boolean;
  incidents_min_severity: string;
  investigations_enabled: boolean;
  assignments_enabled: boolean;
  in_app_enabled: boolean;
  email_enabled: boolean;
  webhook_enabled: boolean;
  webhook_url?: string | null;
  updated_at?: string | null;
}

export interface NotificationPreferenceUpdate {
  alerts_enabled?: boolean;
  alerts_min_severity?: string;
  incidents_enabled?: boolean;
  incidents_min_severity?: string;
  investigations_enabled?: boolean;
  assignments_enabled?: boolean;
  in_app_enabled?: boolean;
  email_enabled?: boolean;
  webhook_enabled?: boolean;
  webhook_url?: string | null;
}

export interface ProviderStatus {
  name: string;
  channel: string;
  is_available: boolean;
  description: string;
}

export interface NotificationProvidersStatusResponse {
  providers: ProviderStatus[];
}

export interface TestWebhookResponse {
  success: boolean;
  status_code?: number | null;
  message: string;
  duration_ms: number;
}
