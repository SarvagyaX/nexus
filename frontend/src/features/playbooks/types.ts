export type PlaybookStatus = 'draft' | 'active' | 'inactive' | 'archived';

export type PlaybookTriggerType =
  | 'manual'
  | 'alert_created'
  | 'incident_created'
  | 'incident_severity_changed'
  | 'incident_assigned';

export type PlaybookActionType =
  | 'create_incident_note'
  | 'assign_incident'
  | 'change_incident_severity'
  | 'send_notification'
  | 'trigger_investigation'
  | 'send_webhook'
  | 'wait_duration'
  | 'require_approval';

export type PlaybookExecutionStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type PlaybookStepExecutionStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export type PlaybookApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface PlaybookStep {
  id: string;
  playbook_id: string;
  step_order: number;
  name: string;
  action_type: PlaybookActionType;
  action_config: Record<string, any>;
  is_enabled: boolean;
  continue_on_failure: boolean;
  timeout_seconds: number;
  created_at: string;
  updated_at: string;
}

export interface PlaybookStepCreate {
  name: string;
  action_type: PlaybookActionType;
  action_config: Record<string, any>;
  step_order?: number;
  is_enabled?: boolean;
  continue_on_failure?: boolean;
  timeout_seconds?: number;
}

export interface Playbook {
  id: string;
  workspace_id: string;
  name: string;
  description?: string | null;
  category: string;
  status: PlaybookStatus;
  trigger_type: PlaybookTriggerType;
  trigger_config: Record<string, any>;
  severity_applicability: string[];
  is_template: boolean;
  template_id?: string | null;
  version: number;
  execution_count: number;
  last_executed_at?: string | null;
  created_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
  steps: PlaybookStep[];
}

export interface PlaybookCreate {
  name: string;
  description?: string;
  category?: string;
  status?: PlaybookStatus;
  trigger_type?: PlaybookTriggerType;
  trigger_config?: Record<string, any>;
  severity_applicability?: string[];
  steps?: PlaybookStepCreate[];
}

export interface PlaybookUpdate {
  name?: string;
  description?: string;
  category?: string;
  status?: PlaybookStatus;
  trigger_type?: PlaybookTriggerType;
  trigger_config?: Record<string, any>;
  severity_applicability?: string[];
  steps?: PlaybookStepCreate[];
}

export interface PlaybookListResponse {
  items: Playbook[];
  total: number;
}

export interface PlaybookApprovalRequest {
  id: string;
  execution_id: string;
  step_execution_id: string;
  prompt: string;
  status: PlaybookApprovalStatus;
  approver_user_id?: string | null;
  comment?: string | null;
  responded_at?: string | null;
  created_at: string;
}

export interface PlaybookStepExecution {
  id: string;
  execution_id: string;
  step_id?: string | null;
  step_order: number;
  step_name: string;
  action_type: PlaybookActionType;
  status: PlaybookStepExecutionStatus;
  input_payload: Record<string, any>;
  output_payload: Record<string, any>;
  error_message?: string | null;
  retry_count: number;
  started_at?: string | null;
  completed_at?: string | null;
  duration_ms?: number | null;
  created_at: string;
  approval?: PlaybookApprovalRequest | null;
}

export interface PlaybookExecution {
  id: string;
  workspace_id: string;
  playbook_id: string;
  playbook_name?: string | null;
  trigger_type: PlaybookTriggerType;
  trigger_event_id?: string | null;
  status: PlaybookExecutionStatus;
  incident_id?: string | null;
  alert_id?: string | null;
  triggered_by_user_id?: string | null;
  current_step_order: number;
  context: Record<string, any>;
  error_message?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  duration_ms?: number | null;
  created_at: string;
  updated_at: string;
  step_executions: PlaybookStepExecution[];
  pending_approval?: PlaybookApprovalRequest | null;
}

export interface PlaybookExecutionListResponse {
  items: PlaybookExecution[];
  total: number;
}

export interface PlaybookTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  trigger_type: PlaybookTriggerType;
  trigger_config: Record<string, any>;
  severity_applicability: string[];
  steps: PlaybookStepCreate[];
}
