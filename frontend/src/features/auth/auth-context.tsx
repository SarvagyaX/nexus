import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { authApi } from './api'
import type { AuthResponse } from './types'

type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error'

type AuthContextValue = {
  status: AuthStatus
  user: AuthResponse['user'] | null
  workspaces: AuthResponse['workspaces']
  activeWorkspaceId: string | null
  csrfToken: string | null
  error: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  setActiveWorkspaceId: (id: string) => void
  reload: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [identity, setIdentity] = useState<AuthResponse | null>(null)
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const applyIdentity = useCallback((value: AuthResponse) => {
    setIdentity(value)
    setActiveWorkspaceId((current) => current && value.workspaces.some((workspace) => workspace.id === current)
      ? current
      : value.active_workspace_id)
    setStatus('authenticated')
    setError(null)
  }, [])

  const reload = useCallback(async () => {
    setStatus('loading')
    try {
      applyIdentity(await authApi.currentUser())
    } catch (cause) {
      const statusCode = (cause as { status?: number }).status
      setIdentity(null)
      setActiveWorkspaceId(null)
      if (statusCode === 401) {
        setStatus('anonymous')
        setError(null)
      } else {
        setStatus('error')
        setError(cause instanceof Error ? cause.message : 'NEXUS could not reach the authentication service.')
      }
    }
  }, [applyIdentity])

  useEffect(() => { void reload() }, [reload])

  const login = useCallback(async (email: string, password: string) => {
    setError(null)
    try {
      applyIdentity(await authApi.login(email, password))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Sign-in failed. Check your details and try again.'
      setError(message)
      throw cause
    }
  }, [applyIdentity])

  const logout = useCallback(async () => {
    if (!identity?.csrf_token) return
    await authApi.logout(identity.csrf_token)
    setIdentity(null)
    setActiveWorkspaceId(null)
    setStatus('anonymous')
    setError(null)
  }, [identity])

  const value = useMemo<AuthContextValue>(() => ({
    status,
    user: identity?.user ?? null,
    workspaces: identity?.workspaces ?? [],
    activeWorkspaceId,
    csrfToken: identity?.csrf_token ?? null,
    error,
    login,
    logout,
    setActiveWorkspaceId,
    reload,
  }), [status, identity, activeWorkspaceId, error, login, logout, reload])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within AuthProvider')
  return value
}
