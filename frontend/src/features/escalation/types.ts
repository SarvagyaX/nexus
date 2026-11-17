export type EscalationTargetType = 'user' | 'on_call_schedule' | 'schedule' | 'webhook';

export type EscalationExecutionStatus = 'active' | 'acknowledged' | 'resolved' | 'exhausted';

export interface EscalationStep {
  id?: string;
  policy_id?: string;
  step_number: number;
  target_type: EscalationTargetType;
  target_user_id?: string | null;
  target_schedule_id?: string | null;
  target_webhook_url?: string | null;
  delay_minutes: number;
}

export interface EscalationPolicy {
  id: string;
  workspace_id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
  min_severity: string;
  service_id?: string | null;
  repeat_count: number;
  steps: EscalationStep[];
  created_at: string;
  updated_at: string;
}

export interface EscalationPolicyCreate {
  name: string;
  description?: string;
  is_active?: boolean;
  min_severity?: string;
  service_id?: string | null;
  repeat_count?: number;
  steps: EscalationStep[];
}

export interface EscalationPolicyUpdate {
  name?: string;
  description?: string;
  is_active?: boolean;
  min_severity?: string;
  service_id?: string | null;
  repeat_count?: number;
  steps?: EscalationStep[];
}

export interface EscalationHistoryEntry {
  step_number: number;
  target_type: string;
  executed_at: string;
  note?: string;
}

export interface EscalationExecution {
  id: string;
  workspace_id: string;
  policy_id: string;
  alert_id?: string | null;
  incident_id?: string | null;
  current_step_number: number;
  status: EscalationExecutionStatus;
  started_at: string;
  next_escalation_at?: string | null;
  acknowledged_at?: string | null;
  acknowledged_by_user_id?: string | null;
  resolved_at?: string | null;
  history: EscalationHistoryEntry[];
  created_at: string;
}
