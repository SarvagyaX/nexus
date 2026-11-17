export type ServiceStatus = 'active' | 'archived'

export type Service = {
  id: string
  workspace_id: string
  name: string
  service_key: string
  description: string | null
  owner_team: string | null
  environment: string | null
  repository_url: string | null
  status: ServiceStatus
  created_at: string
  updated_at: string
}

export type ServiceInput = {
  name: string
  service_key: string
  description?: string | null
  owner_team?: string | null
  environment?: string | null
  repository_url?: string | null
}

export type ServicePatch = Partial<ServiceInput> & { status?: ServiceStatus }

export type ServicePage = {
  limit: number
  next_cursor: string | null
  has_more: boolean
}

export type ServiceListResponse = {
  items: Service[]
  page: ServicePage
}

export type ServiceListParams = {
  status?: ServiceStatus
  q?: string
  limit?: number
  cursor?: string | null
}
