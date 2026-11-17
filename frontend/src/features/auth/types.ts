export type WorkspaceRole = 'admin' | 'responder' | 'commander' | 'viewer'

export type AuthUser = {
  id: string
  email: string
  display_name: string
}

export type AuthWorkspace = {
  id: string
  name: string
  slug: string
  role: WorkspaceRole
}

export type AuthResponse = {
  user: AuthUser
  workspaces: AuthWorkspace[]
  active_workspace_id: string | null
  csrf_token: string
}
