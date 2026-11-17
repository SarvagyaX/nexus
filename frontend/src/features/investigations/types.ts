export type InvestigationStatus = 'pending' | 'running' | 'completed' | 'failed'

export type EvidenceType = 'log' | 'incident' | 'service' | 'metric'

export type RecommendationStatus = 'pending_approval' | 'approved' | 'rejected'

export interface EvidenceItem {
  id: string
  workspace_id: string
  investigation_id: string
  evidence_type: EvidenceType
  source_id: string
  title: string
  summary: string
  data: Record<string, unknown>
  collected_at: string
}

export interface HypothesisItem {
  id: string
  workspace_id: string
  investigation_id: string
  title: string
  description: string
  likelihood: string
  confidence_score: number
  supporting_evidence: string[]
  contradicting_evidence: string[]
  is_primary: boolean
  created_at: string
}

export interface RecommendationItem {
  id: string
  workspace_id: string
  investigation_id: string
  title: string
  description: string
  action_type: string
  priority: string
  rationale: string
  status: RecommendationStatus
  reviewed_by_user_id?: string | null
  reviewed_at?: string | null
  review_notes?: string | null
  created_at: string
}

export interface InvestigationSummary {
  id: string
  workspace_id: string
  incident_id: string
  status: InvestigationStatus
  summary?: string | null
  confidence_score?: number | null
  error_message?: string | null
  started_at?: string | null
  completed_at?: string | null
  created_by_user_id?: string | null
  created_at: string
  updated_at: string
  incident_title?: string | null
  incident_severity?: string | null
  evidence_count: number
  hypotheses_count: number
  recommendations_count: number
}

export interface InvestigationDetail {
  id: string
  workspace_id: string
  incident_id: string
  status: InvestigationStatus
  summary?: string | null
  confidence_score?: number | null
  error_message?: string | null
  started_at?: string | null
  completed_at?: string | null
  created_by_user_id?: string | null
  created_at: string
  updated_at: string
  incident_title?: string | null
  incident_severity?: string | null
  incident_service_id?: string | null
  incident_service_name?: string | null
  evidence: EvidenceItem[]
  hypotheses: HypothesisItem[]
  recommendations: RecommendationItem[]
}

export interface InvestigationListParams {
  incident_id?: string
  status?: InvestigationStatus
  cursor?: string | null
  limit?: number
}

export interface InvestigationListResponse {
  items: InvestigationSummary[]
  next_cursor?: string | null
}

export interface ProviderStatus {
  provider: string
  model: string
  is_available: boolean
  message: string
}
