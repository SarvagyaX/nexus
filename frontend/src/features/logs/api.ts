import type {
  LogCreateInput,
  LogListParams,
  LogListResponse,
  LogRecord,
  LogStatsResponse,
} from './types'

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '')

type ApiErrorBody = {
  error?: {
    code?: string
    message?: string
    details?: Array<{ field?: string; reason?: string }>
  }
}

export class LogApiError extends Error {
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
    this.name = 'LogApiError'
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
    throw new LogApiError(
      'NEXUS could not reach the logs service. Check your connection and retry.',
      0,
      'network_error'
    )
  }

  if (!response.ok) {
    let body: ApiErrorBody = {}
    try {
      body = (await response.json()) as ApiErrorBody
    } catch {
      /* retain safe fallback */
    }
    throw new LogApiError(
      body.error?.message ?? 'The logs request could not be completed.',
      response.status,
      body.error?.code ?? 'request_failed',
      body.error?.details ?? []
    )
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function path(workspaceId: string) {
  return `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/logs`
}

export const logsApi = {
  list(workspaceId: string, params: LogListParams = {}, signal?: AbortSignal): Promise<LogListResponse> {
    const query = new URLSearchParams()
    query.set('limit', String(params.limit ?? 50))
    if (params.severity) query.set('severity', params.severity)
    if (params.service_id) query.set('service_id', params.service_id)
    if (params.trace_id) query.set('trace_id', params.trace_id)
    if (params.from) query.set('from', params.from)
    if (params.to) query.set('to', params.to)
    if (params.q?.trim()) query.set('q', params.q.trim())
    if (params.cursor) query.set('cursor', params.cursor)
    return request<LogListResponse>(`${path(workspaceId)}?${query}`, { signal })
  },

  stats(workspaceId: string, params: LogListParams = {}, signal?: AbortSignal): Promise<LogStatsResponse> {
    const query = new URLSearchParams()
    if (params.service_id) query.set('service_id', params.service_id)
    if (params.severity) query.set('severity', params.severity)
    if (params.trace_id) query.set('trace_id', params.trace_id)
    if (params.from) query.set('from', params.from)
    if (params.to) query.set('to', params.to)
    if (params.q?.trim()) query.set('q', params.q.trim())
    return request<LogStatsResponse>(`${path(workspaceId)}/stats?${query}`, { signal })
  },

  get(workspaceId: string, logId: string, signal?: AbortSignal): Promise<LogRecord> {
    return request<LogRecord>(`${path(workspaceId)}/${encodeURIComponent(logId)}`, { signal })
  },

  ingest(workspaceId: string, payload: LogCreateInput, csrfToken: string): Promise<LogRecord> {
    return request<LogRecord>(
      path(workspaceId),
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      csrfToken
    )
  },

  batchIngest(
    workspaceId: string,
    items: LogCreateInput[],
    csrfToken: string
  ): Promise<{ ingested_count: number; ids: string[] }> {
    return request<{ ingested_count: number; ids: string[] }>(
      `${path(workspaceId)}/batch`,
      {
        method: 'POST',
        body: JSON.stringify({ items }),
      },
      csrfToken
    )
  },
}
