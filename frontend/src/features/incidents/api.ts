import type {
  Incident, IncidentCreateInput, IncidentEvent, IncidentEventListResponse,
  IncidentListParams, IncidentListResponse, IncidentPatch, IncidentTransition,
} from './types'

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '')

type ApiErrorBody = { error?: { code?: string; message?: string; details?: Array<{ field?: string; reason?: string }> } }

export class IncidentApiError extends Error {
  status: number
  code: string
  details: Array<{ field?: string; reason?: string }>

  constructor(message: string, status: number, code: string, details: Array<{ field?: string; reason?: string }> = []) {
    super(message)
    this.name = 'IncidentApiError'
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
    throw new IncidentApiError('NEXUS could not reach the incident API. Check your connection and retry.', 0, 'network_error')
  }
  if (!response.ok) {
    let body: ApiErrorBody = {}
    try { body = (await response.json()) as ApiErrorBody } catch { /* use safe fallback */ }
    throw new IncidentApiError(body.error?.message ?? 'The incident request could not be completed.', response.status,
      body.error?.code ?? 'request_failed', body.error?.details ?? [])
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function path(workspaceId: string) {
  return `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/incidents`
}

export const incidentsApi = {
  list(workspaceId: string, params: IncidentListParams = {}, signal?: AbortSignal) {
    const query = new URLSearchParams({ limit: String(params.limit ?? 25) })
    if (params.status) query.set('status', params.status)
    if (params.severity) query.set('severity', params.severity)
    if (params.service_id) query.set('service_id', params.service_id)
    if (params.assignee_user_id) query.set('assignee_user_id', params.assignee_user_id)
    if (params.q?.trim()) query.set('q', params.q.trim())
    if (params.cursor) query.set('cursor', params.cursor)
    return request<IncidentListResponse>(`${path(workspaceId)}?${query}`, { signal })
  },
  get(workspaceId: string, incidentId: string, signal?: AbortSignal) {
    return request<Incident>(`${path(workspaceId)}/${encodeURIComponent(incidentId)}`, { signal })
  },
  create(workspaceId: string, payload: IncidentCreateInput, csrfToken: string) {
    return request<Incident>(path(workspaceId), { method: 'POST', body: JSON.stringify(payload) }, csrfToken)
  },
  update(workspaceId: string, incidentId: string, payload: IncidentPatch, csrfToken: string) {
    return request<Incident>(`${path(workspaceId)}/${encodeURIComponent(incidentId)}`, { method: 'PATCH', body: JSON.stringify(payload) }, csrfToken)
  },
  transition(workspaceId: string, incidentId: string, payload: IncidentTransition, csrfToken: string) {
    return request<Incident>(`${path(workspaceId)}/${encodeURIComponent(incidentId)}/transitions`, { method: 'POST', body: JSON.stringify(payload) }, csrfToken)
  },
  events(workspaceId: string, incidentId: string, cursor?: string | null, signal?: AbortSignal) {
    const query = new URLSearchParams({ limit: '100' })
    if (cursor) query.set('cursor', cursor)
    return request<IncidentEventListResponse>(`${path(workspaceId)}/${encodeURIComponent(incidentId)}/events?${query}`, { signal })
  },
  addNote(workspaceId: string, incidentId: string, body: string, csrfToken: string) {
    return request<IncidentEvent>(`${path(workspaceId)}/${encodeURIComponent(incidentId)}/events`, {
      method: 'POST', body: JSON.stringify({ body }),
    }, csrfToken)
  },
  async all(workspaceId: string, signal?: AbortSignal): Promise<Incident[]> {
    const items: Incident[] = []
    let cursor: string | null = null
    const seenCursors = new Set<string>()
    do {
      if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError')
      const page = await incidentsApi.list(workspaceId, { limit: 100, cursor }, signal)
      items.push(...page.items)
      cursor = page.page.next_cursor
      if (cursor && seenCursors.has(cursor)) throw new IncidentApiError('Incident pagination did not advance. Retry the request.', 500, 'pagination_error')
      if (cursor) seenCursors.add(cursor)
    } while (cursor)
    return items
  },
}
