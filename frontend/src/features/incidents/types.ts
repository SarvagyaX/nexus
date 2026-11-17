export type IncidentSeverity = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4'
export type IncidentStatus = 'open' | 'investigating' | 'monitoring' | 'resolved'
export type SeveritySource = 'human' | 'agent' | 'demo'

export type IncidentServiceSummary = { id: string; name: string; service_key: string }
export type IncidentAssigneeSummary = { id: string; display_name: string; email: string }

export type Incident = {
  id: string
  workspace_id: string
  service_id: string
  reference: string
  title: string
  summary: string | null
  severity: IncidentSeverity
  status: IncidentStatus
  severity_source: SeveritySource
  assignee_user_id: string | null
  detected_at: string
  started_at: string | null
  resolved_at: string | null
  resolution_summary: string | null
  created_by_user_id: string | null
  created_at: string
  updated_at: string
  service: IncidentServiceSummary | null
  assignee: IncidentAssigneeSummary | null
}

export type IncidentEvent = {
  id: string
  workspace_id: string
  incident_id: string
  actor_user_id: string | null
  event_type: string
  body: string | null
  payload: Record<string, unknown>
  created_at: string
}

export type IncidentPage = { limit: number; next_cursor: string | null; has_more: boolean }
export type IncidentListResponse = { items: Incident[]; page: IncidentPage }
export type IncidentEventListResponse = { items: IncidentEvent[]; page: IncidentPage }
export type IncidentListParams = {
  status?: IncidentStatus
  severity?: IncidentSeverity
  service_id?: string
  assignee_user_id?: string
  q?: string
  limit?: number
  cursor?: string | null
}
export type IncidentCreateInput = {
  service_id: string
  title: string
  summary: string | null
  severity: IncidentSeverity
  detected_at: string
  started_at?: string | null
}
export type IncidentPatch = {
  title?: string
  summary?: string | null
  severity?: IncidentSeverity
  assignee_user_id?: string | null
}
export type IncidentTransition = {
  to_status: IncidentStatus
  reason?: string
  resolution_summary?: string
}
