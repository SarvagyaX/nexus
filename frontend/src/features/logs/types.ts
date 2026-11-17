export type LogSeverity = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'

export type LogServiceSummary = {
  id: string
  name: string
  service_key: string
}

export type LogRecord = {
  id: string
  workspace_id: string
  service_id: string
  timestamp: string
  severity: LogSeverity
  trace_id: string | null
  message: string
  attributes: Record<string, unknown>
  created_at: string
  service: LogServiceSummary | null
}

export type LogPage = {
  limit: number
  next_cursor: string | null
  has_more: boolean
}

export type LogListResponse = {
  items: LogRecord[]
  page: LogPage
}

export type LogTimeBucket = {
  timestamp: string
  count: number
  severity_breakdown: Record<string, number>
}

export type LogStatsResponse = {
  total_count: number
  severity_counts: Record<string, number>
  time_buckets: LogTimeBucket[]
  service_counts: Record<string, number>
}

export type LogListParams = {
  severity?: LogSeverity
  service_id?: string
  trace_id?: string
  from?: string
  to?: string
  q?: string
  limit?: number
  cursor?: string | null
}

export type LogCreateInput = {
  service_id: string
  timestamp?: string
  severity?: LogSeverity
  trace_id?: string | null
  message: string
  attributes?: Record<string, unknown>
}
