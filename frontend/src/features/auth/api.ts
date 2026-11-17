import type { AuthResponse } from './types'

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '')

type ApiErrorEnvelope = { error?: { message?: string; code?: string } }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (!response.ok) {
    let message = 'The request could not be completed.'
    try {
      const body = (await response.json()) as ApiErrorEnvelope
      message = body.error?.message ?? message
    } catch {
      // Keep transport and server failures generic in the interface.
    }
    throw Object.assign(new Error(message), { status: response.status })
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const authApi = {
  currentUser: () => request<AuthResponse>('/api/v1/auth/me'),
  login: (email: string, password: string) =>
    request<AuthResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: (csrfToken: string) =>
    request<void>('/api/v1/auth/logout', {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken },
    }),
}
