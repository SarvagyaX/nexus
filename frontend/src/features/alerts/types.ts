export type AlertSeverity = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';

export type AlertStatus = 'open' | 'acknowledged' | 'snoozed' | 'resolved';

export type AlertRuleCondition = 'error_count' | 'fatal_log' | 'error_rate' | 'repeated_failures';

export interface AlertRule {
  id: string;
  workspace_id: string;
  service_id: string | null;
  service_name: string | null;
  name: string;
  description: string | null;
  enabled: boolean;
  severity: AlertSeverity;
  condition_type: AlertRuleCondition;
  threshold: number;
  window_minutes: number;
  cooldown_minutes: number;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AlertRuleCreate {
  name: string;
  description?: string;
  service_id?: string | null;
  enabled?: boolean;
  severity: AlertSeverity;
  condition_type: AlertRuleCondition;
  threshold: number;
  window_minutes: number;
  cooldown_minutes: number;
}

export interface AlertRulePatch {
  name?: string;
  description?: string;
  service_id?: string | null;
  enabled?: boolean;
  severity?: AlertSeverity;
  condition_type?: AlertRuleCondition;
  threshold?: number;
  window_minutes?: number;
  cooldown_minutes?: number;
}

export interface AlertSummary {
  id: string;
  workspace_id: string;
  rule_id: string | null;
  service_id: string | null;
  service_name: string | null;
  rule_name: string | null;
  incident_id: string | null;
  incident_reference: string | null;
  fingerprint: string;
  title: string;
  description: string | null;
  severity: AlertSeverity;
  status: AlertStatus;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  snoozed_until: string | null;
  acknowledged_at: string | null;
  acknowledged_by_user_id: string | null;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  resolution_note: string | null;
  data: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface AlertEvent {
  id: string;
  workspace_id: string;
  alert_id: string;
  actor_user_id: string | null;
  event_type: string;
  message: string | null;
  payload: Record<string, any>;
  created_at: string;
}

export interface AlertDetail extends AlertSummary {
  events: AlertEvent[];
}

export interface AlertStats {
  total_open: number;
  total_acknowledged: number;
  total_snoozed: number;
  total_resolved: number;
  sev1_count: number;
  sev2_count: number;
  sev3_count: number;
  sev4_count: number;
  total_critical: number;
}

export interface AlertGroup {
  group_key: string;
  service_id: string | null;
  service_name: string | null;
  count: number;
  highest_severity: AlertSeverity;
  latest_seen_at: string;
  alerts: AlertSummary[];
}

export interface AlertListResponse {
  items: AlertSummary[];
  page: {
    limit: number;
    has_more: boolean;
    next_cursor: string | null;
  };
}

export interface AlertRuleListResponse {
  items: AlertRule[];
}

export interface AlertGroupListResponse {
  groups: AlertGroup[];
}

export interface AlertEvaluationResult {
  evaluated_rules: number;
  new_alerts_count: number;
  updated_alerts_count: number;
  alerts: AlertSummary[];
}
