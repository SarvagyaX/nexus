import type { Service, ServiceInput, ServiceListParams, ServiceListResponse, ServicePatch } from './types'

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '')

type ApiErrorBody = {
  error?: { code?: string; message?: string; details?: Array<{ field?: string; reason?: string }> }
}

export class ServiceApiError extends Error {
  status: number
  code: string
  details: Array<{ field?: string; reason?: string }>

  constructor(message: string, status: number, code: string, details: Array<{ field?: string; reason?: string }> = []) {
    super(message)
    this.name = 'ServiceApiError'
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
    throw new ServiceApiError('NEXUS could not reach the service API. Check your connection and retry.', 0, 'network_error')
  }

  if (!response.ok) {
    let body: ApiErrorBody = {}
    try { body = (await response.json()) as ApiErrorBody } catch { /* retain a safe generic message */ }
    throw new ServiceApiError(
      body.error?.message ?? 'The service request could not be completed.',
      response.status,
      body.error?.code ?? 'request_failed',
      body.error?.details ?? [],
    )
  }

  return (await response.json()) as T
}

function workspaceServicesPath(workspaceId: string) {
  return `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/services`
}

export const servicesApi = {
  list(workspaceId: string, params: ServiceListParams = {}, signal?: AbortSignal) {
    const query = new URLSearchParams()
    query.set('limit', String(params.limit ?? 25))
    if (params.status) query.set('status', params.status)
    if (params.q?.trim()) query.set('q', params.q.trim())
    if (params.cursor) query.set('cursor', params.cursor)
    return request<ServiceListResponse>(`${workspaceServicesPath(workspaceId)}?${query}`, { signal })
  },
  get(workspaceId: string, serviceId: string, signal?: AbortSignal) {
    return request<Service>(`${workspaceServicesPath(workspaceId)}/${encodeURIComponent(serviceId)}`, { signal })
  },
  create(workspaceId: string, payload: ServiceInput, csrfToken: string) {
    return request<Service>(workspaceServicesPath(workspaceId), {
      method: 'POST',
      body: JSON.stringify(payload),
    }, csrfToken)
  },
  update(workspaceId: string, serviceId: string, payload: ServicePatch, csrfToken: string) {
    return request<Service>(`${workspaceServicesPath(workspaceId)}/${encodeURIComponent(serviceId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }, csrfToken)
  },
  async all(workspaceId: string, signal?: AbortSignal): Promise<Service[]> {
    const items: Service[] = []
    let cursor: string | null = null
    do {
      const page = await servicesApi.list(workspaceId, { limit: 100, cursor }, signal)
      items.push(...page.items)
      cursor = page.page.next_cursor
    } while (cursor)
    return items
  },
}
