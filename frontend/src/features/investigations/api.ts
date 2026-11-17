import type {
  InvestigationDetail,
  InvestigationListParams,
  InvestigationListResponse,
  ProviderStatus,
  RecommendationItem,
  RecommendationStatus,
} from './types'

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '')

type ApiErrorBody = {
  error?: {
    code?: string
    message?: string
    details?: Array<{ field?: string; reason?: string }>
  }
}

export class InvestigationApiError extends Error {
  status: number
  code: string
  details: Array<{ field?: string; reason?: string }>

  constructor(
    message: string,
    status: number,
    code: string,
    details: Array<{ field?: string; reason?: string }> = []
  ) {
    super(message)
    this.name = 'InvestigationApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

async function request<T>(path: string, init: RequestInit = {}, csrfToken?: string): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken)

  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, { ...init, headers, credentials: 'include' })
  } catch {
    throw new InvestigationApiError(
      'NEXUS could not reach the investigation service. Check your connection and retry.',
      0,
      'network_error'
    )
  }

  if (response.status === 204) return undefined as T

  const contentType = response.headers.get('content-type') ?? ''
  const isJson = contentType.includes('application/json')
  const payload = isJson ? ((await response.json()) as unknown) : null

  if (!response.ok) {
    const errorBody = payload as ApiErrorBody | null
    const message =
      errorBody?.error?.message ??
      (response.status === 401
        ? 'Your session has expired. Sign in again.'
        : response.status === 403
          ? 'You do not have permission to perform this action.'
          : response.status === 404
            ? 'The requested investigation resource was not found.'
            : 'The investigation request could not be completed.')
    const code = errorBody?.error?.code ?? (response.status === 0 ? 'network_error' : 'request_failed')
    const details = errorBody?.error?.details ?? []
    throw new InvestigationApiError(message, response.status, code, details)
  }

  return payload as T
}

export const investigationsApi = {
  list(workspaceId: string, params: InvestigationListParams = {}): Promise<InvestigationListResponse> {
    const search = new URLSearchParams()
    if (params.incident_id) search.set('incident_id', params.incident_id)
    if (params.status) search.set('status', params.status)
    if (params.cursor) search.set('cursor', params.cursor)
    if (typeof params.limit === 'number') search.set('limit', String(params.limit))

    const query = search.toString()
    return request<InvestigationListResponse>(
      `/api/v1/workspaces/${workspaceId}/investigations${query ? `?${query}` : ''}`
    )
  },

  get(workspaceId: string, investigationId: string): Promise<InvestigationDetail> {
    return request<InvestigationDetail>(
      `/api/v1/workspaces/${workspaceId}/investigations/${investigationId}`
    )
  },

  start(workspaceId: string, incidentId: string, csrfToken: string): Promise<InvestigationDetail> {
    return request<InvestigationDetail>(
      `/api/v1/workspaces/${workspaceId}/investigations`,
      {
        method: 'POST',
        body: JSON.stringify({ incident_id: incidentId }),
      },
      csrfToken
    )
  },

  retry(workspaceId: string, investigationId: string, csrfToken: string): Promise<InvestigationDetail> {
    return request<InvestigationDetail>(
      `/api/v1/workspaces/${workspaceId}/investigations/${investigationId}/retry`,
      {
        method: 'POST',
      },
      csrfToken
    )
  },

  reviewRecommendation(
    workspaceId: string,
    investigationId: string,
    recommendationId: string,
    status: RecommendationStatus,
    reviewNotes: string | undefined,
    csrfToken: string
  ): Promise<RecommendationItem> {
    return request<RecommendationItem>(
      `/api/v1/workspaces/${workspaceId}/investigations/${investigationId}/recommendations/${recommendationId}/review`,
      {
        method: 'POST',
        body: JSON.stringify({
          status,
          review_notes: reviewNotes || null,
        }),
      },
      csrfToken
    )
  },

  getProviderStatus(workspaceId: string): Promise<ProviderStatus> {
    return request<ProviderStatus>(
      `/api/v1/workspaces/${workspaceId}/investigations/provider-status`
    )
  },
}
