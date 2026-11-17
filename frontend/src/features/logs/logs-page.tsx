import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Clock,
  Layers,
  Pause,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { cn } from '../../lib/utils'
import { useAuth } from '../auth/auth-context'
import { servicesApi } from '../services/api'
import type { Service } from '../services/types'
import { logsApi } from './api'
import {
  formatLogTime,
  LogDrawer,
  LogEmptyState,
  LogSeverityBadge,
  LogSkeleton,
  LogVolumeChart,
  SeverityDistributionBar,
} from './log-ui'
import type { LogListResponse, LogRecord, LogSeverity, LogStatsResponse } from './types'

const TIME_RANGES = [
  { label: 'Last 15m', minutes: 15 },
  { label: 'Last 1h', minutes: 60 },
  { label: 'Last 6h', minutes: 360 },
  { label: 'Last 24h', minutes: 1440 },
  { label: 'Last 7d', minutes: 10080 },
  { label: 'All time', minutes: 0 },
]

export function LogsPage() {
  const { activeWorkspaceId, workspaces, csrfToken } = useAuth()
  const role = workspaces.find((w) => w.id === activeWorkspaceId)?.role
  const canWrite = role === 'admin' || role === 'commander' || role === 'responder'

  // Filter States
  const [search, setSearch] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedSeverity, setSelectedSeverity] = useState<LogSeverity | undefined>(undefined)
  const [selectedServiceId, setSelectedServiceId] = useState<string>('')
  const [traceIdFilter, setTraceIdFilter] = useState<string>('')
  const [timeRangeMinutes, setTimeRangeMinutes] = useState<number>(1440) // Default 24h

  // Pagination
  const [cursor, setCursor] = useState<string | null>(null)
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([])

  // Data States
  const [logsData, setLogsData] = useState<LogListResponse | null>(null)
  const [statsData, setStatsData] = useState<LogStatsResponse | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [statsLoading, setStatsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Drawer & Inspection
  const [selectedLog, setSelectedLog] = useState<LogRecord | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Live Auto-Refresh
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [seeding, setSeeding] = useState(false)

  // Compute time bounds from selected range
  const { fromIso, toIso } = useMemo(() => {
    if (timeRangeMinutes === 0) return { fromIso: undefined, toIso: undefined }
    const now = new Date()
    const from = new Date(now.getTime() - timeRangeMinutes * 60 * 1000)
    return { fromIso: from.toISOString(), toIso: now.toISOString() }
  }, [timeRangeMinutes, refreshTrigger])

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])

  // Reset pagination when primary filters change
  useEffect(() => {
    setCursor(null)
    setCursorStack([])
  }, [selectedSeverity, selectedServiceId, traceIdFilter, debouncedQuery, timeRangeMinutes, activeWorkspaceId])

  // Load registered services for the service filter
  useEffect(() => {
    if (!activeWorkspaceId) return
    const controller = new AbortController()
    servicesApi
      .all(activeWorkspaceId, controller.signal)
      .then(setServices)
      .catch(() => {
        /* ignore */
      })
    return () => controller.abort()
  }, [activeWorkspaceId])

  // Load Logs
  useEffect(() => {
    if (!activeWorkspaceId) {
      setLogsData(null)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    logsApi
      .list(
        activeWorkspaceId,
        {
          severity: selectedSeverity,
          service_id: selectedServiceId || undefined,
          trace_id: traceIdFilter || undefined,
          from: fromIso,
          to: toIso,
          q: debouncedQuery || undefined,
          limit: 50,
          cursor,
        },
        controller.signal
      )
      .then((res) => {
        setLogsData(res)
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Could not load logs.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [
    activeWorkspaceId,
    selectedSeverity,
    selectedServiceId,
    traceIdFilter,
    fromIso,
    toIso,
    debouncedQuery,
    cursor,
    refreshTrigger,
  ])

  // Load Stats & Histogram
  useEffect(() => {
    if (!activeWorkspaceId) {
      setStatsData(null)
      setStatsLoading(false)
      return
    }

    const controller = new AbortController()
    setStatsLoading(true)

    logsApi
      .stats(
        activeWorkspaceId,
        {
          service_id: selectedServiceId || undefined,
          severity: selectedSeverity,
          trace_id: traceIdFilter || undefined,
          from: fromIso,
          to: toIso,
          q: debouncedQuery || undefined,
        },
        controller.signal
      )
      .then(setStatsData)
      .catch(() => {
        /* ignore */
      })
      .finally(() => {
        if (!controller.signal.aborted) setStatsLoading(false)
      })

    return () => controller.abort()
  }, [
    activeWorkspaceId,
    selectedSeverity,
    selectedServiceId,
    traceIdFilter,
    fromIso,
    toIso,
    debouncedQuery,
    refreshTrigger,
  ])

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => {
      setRefreshTrigger((prev) => prev + 1)
    }, 6000)
    return () => clearInterval(interval)
  }, [autoRefresh])

  const handleNextPage = () => {
    if (!logsData?.page.next_cursor) return
    setCursorStack((prev) => [...prev, cursor])
    setCursor(logsData.page.next_cursor)
  }

  const handlePrevPage = () => {
    if (cursorStack.length === 0) return
    const prevStack = [...cursorStack]
    const prevCursor = prevStack.pop() ?? null
    setCursorStack(prevStack)
    setCursor(prevCursor)
  }

  const handleOpenLog = (log: LogRecord) => {
    setSelectedLog(log)
    setDrawerOpen(true)
  }

  const clearAllFilters = () => {
    setSearch('')
    setDebouncedQuery('')
    setSelectedSeverity(undefined)
    setSelectedServiceId('')
    setTraceIdFilter('')
    setTimeRangeMinutes(1440)
  }

  const hasActiveFilters = Boolean(
    debouncedQuery || selectedSeverity || selectedServiceId || traceIdFilter || timeRangeMinutes !== 1440
  )

  // Seed realistic telemetry logs for instant interactive exploration
  const handleSeedSampleLogs = async () => {
    if (!activeWorkspaceId || !csrfToken || services.length === 0) return
    setSeeding(true)
    try {
      const activeSvc = services.filter((s) => s.status === 'active')
      const targetServices = activeSvc.length > 0 ? activeSvc : services
      const now = Date.now()

      const samples = [
        {
          service_id: targetServices[0 % targetServices.length].id,
          severity: 'INFO' as LogSeverity,
          message: 'HTTP GET /api/v1/workspaces - 200 OK in 14ms',
          trace_id: 'tr-8f92a10c',
          timestamp: new Date(now - 120000).toISOString(),
          attributes: { http_status: 200, route: '/api/v1/workspaces', client_ip: '10.0.4.12', latency_ms: 14 },
        },
        {
          service_id: targetServices[1 % targetServices.length].id,
          severity: 'INFO' as LogSeverity,
          message: 'Database connection pool acquired worker session [pool_size=10, active=4]',
          trace_id: 'tr-8f92a10c',
          timestamp: new Date(now - 100000).toISOString(),
          attributes: { pool_active: 4, pool_max: 10, db_host: 'postgres-primary.internal' },
        },
        {
          service_id: targetServices[0 % targetServices.length].id,
          severity: 'WARN' as LogSeverity,
          message: 'Redis cache miss on session token validation; falling back to PostgreSQL',
          trace_id: 'tr-c49b81f3',
          timestamp: new Date(now - 80000).toISOString(),
          attributes: { cache_key: 'session:digest:c84e7', ttl_remaining: 0, fallback: true },
        },
        {
          service_id: targetServices[1 % targetServices.length].id,
          severity: 'ERROR' as LogSeverity,
          message: 'Stripe webhook verification failed: signature timestamp out of tolerance window',
          trace_id: 'tr-e104f29a',
          timestamp: new Date(now - 60000).toISOString(),
          attributes: { provider: 'stripe', attempt: 1, delta_seconds: 340, signature_v1: 't=1731600000,v1=sha256' },
        },
        {
          service_id: targetServices[0 % targetServices.length].id,
          severity: 'DEBUG' as LogSeverity,
          message: 'Ingestion pipeline worker thread spawned [worker_id=worker-4, queue_depth=2]',
          trace_id: 'tr-b649012a',
          timestamp: new Date(now - 45000).toISOString(),
          attributes: { thread_id: 140392, queue: 'nexus-telemetry-inbound' },
        },
        {
          service_id: targetServices[1 % targetServices.length].id,
          severity: 'FATAL' as LogSeverity,
          message: 'Circuit breaker tripped for upstream payment-gateway: error rate exceeded threshold (15.2% > 5%)',
          trace_id: 'tr-e104f29a',
          timestamp: new Date(now - 20000).toISOString(),
          attributes: {
            circuit: 'payment-gateway',
            failure_rate_pct: 15.2,
            threshold_pct: 5.0,
            consecutive_failures: 12,
            action: 'circuit_opened',
          },
        },
        {
          service_id: targetServices[0 % targetServices.length].id,
          severity: 'INFO' as LogSeverity,
          message: 'Healthcheck probe succeeded for liveness check: /health returned status=ok',
          trace_id: 'tr-71da09bc',
          timestamp: new Date(now - 5000).toISOString(),
          attributes: { probe: 'liveness', response_code: 200 },
        },
      ]

      await logsApi.batchIngest(activeWorkspaceId, samples, csrfToken)
      setRefreshTrigger((prev) => prev + 1)
    } catch {
      /* ignore */
    } finally {
      setSeeding(false)
    }
  }

  const logs = logsData?.items ?? []
  const totalCount = statsData?.total_count ?? logs.length
  const severityCounts = statsData?.severity_counts ?? {}
  const errorCount = (severityCounts['ERROR'] || 0) + (severityCounts['FATAL'] || 0)
  const errorRate = totalCount > 0 ? ((errorCount / totalCount) * 100).toFixed(1) : '0.0'

  return (
    <div className="mx-auto max-w-[1540px] space-y-6">
      {/* Page Title & Realtime Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em]">
            <span className="text-sky-300">Observability</span>
            <span className="text-slate-700">/</span>
            <span className="text-slate-500">Telemetry</span>
          </div>
          <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-slate-100 sm:text-[34px]">
            Logs Explorer
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-400">
            High-density structured log stream, telemetry distribution, and distributed trace inspection.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Live Auto-Refresh Toggle */}
          <Button
            variant={autoRefresh ? 'default' : 'secondary'}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={autoRefresh ? 'bg-emerald-500 hover:bg-emerald-600 text-black font-semibold' : ''}
          >
            {autoRefresh ? (
              <>
                <span className="size-2 rounded-full bg-black animate-ping" />
                <Pause className="size-3.5" /> Live Streaming
              </>
            ) : (
              <>
                <Play className="size-3.5" /> Start Live
              </>
            )}
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setRefreshTrigger((prev) => prev + 1)}
            disabled={loading}
            title="Refresh logs"
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            <span>Refresh</span>
          </Button>

          {canWrite && services.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSeedSampleLogs}
              disabled={seeding}
              className="text-xs"
            >
              <Sparkles className="size-3.5 text-sky-400" />
              <span>{seeding ? 'Ingesting...' : 'Ingest Sample Logs'}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Top Observability KPI Cards */}
      <section aria-label="Logs summary metrics" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="transition-colors hover:border-white/[0.14]">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-400">Total Log Volume</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-100">
                  {statsLoading ? (
                    <span className="inline-block h-7 w-16 animate-pulse rounded bg-white/[0.08]" />
                  ) : (
                    totalCount.toLocaleString()
                  )}
                </p>
              </div>
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-sky-400/10 text-sky-300">
                <Terminal className="size-4" />
              </span>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Events in current time window</p>
          </CardContent>
        </Card>

        <Card className="transition-colors hover:border-white/[0.14]">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-400">Error & Fatal Events</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-rose-300">
                  {statsLoading ? (
                    <span className="inline-block h-7 w-12 animate-pulse rounded bg-white/[0.08]" />
                  ) : (
                    errorCount.toLocaleString()
                  )}
                </p>
              </div>
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-rose-500/10 text-rose-400">
                <AlertCircle className="size-4" />
              </span>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              <span className={errorCount > 0 ? 'font-semibold text-rose-400' : 'text-slate-400'}>
                {errorRate}% error rate
              </span>
            </p>
          </CardContent>
        </Card>

        <Card className="transition-colors hover:border-white/[0.14]">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-400">Active Services</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-100">
                  {services.length}
                </p>
              </div>
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-400/10 text-emerald-300">
                <Layers className="size-4" />
              </span>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Registered workspace services</p>
          </CardContent>
        </Card>

        <Card className="transition-colors hover:border-white/[0.14]">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-400">Active Window</p>
                <p className="mt-2 text-base font-semibold tracking-tight text-slate-100">
                  {TIME_RANGES.find((r) => r.minutes === timeRangeMinutes)?.label ?? 'Custom'}
                </p>
              </div>
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-violet-400/10 text-violet-300">
                <Clock className="size-4" />
              </span>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              {timeRangeMinutes === 0 ? 'Unbounded search' : `From ${timeRangeMinutes / 60}h ago to now`}
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Visual Analytics & Severity Breakdown Panel */}
      <Card className="overflow-hidden border-border/80">
        <CardHeader className="flex-row items-center justify-between border-b border-border/60 px-5 py-3">
          <div>
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Telemetry Volume & Severity Distribution
            </CardTitle>
          </div>

          {/* Time range preset selector */}
          <div className="flex items-center gap-1 rounded-lg border border-border/80 bg-background/70 p-0.5 text-xs">
            {TIME_RANGES.map((range) => {
              const active = timeRangeMinutes === range.minutes
              return (
                <button
                  key={range.label}
                  type="button"
                  onClick={() => setTimeRangeMinutes(range.minutes)}
                  className={cn(
                    'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                    active
                      ? 'bg-sky-400/20 text-sky-200 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  )}
                >
                  {range.label}
                </button>
              )
            })}
          </div>
        </CardHeader>
        <CardContent className="p-5 space-y-5">
          <LogVolumeChart buckets={statsData?.time_buckets ?? []} />
          <SeverityDistributionBar
            counts={severityCounts}
            total={totalCount}
            activeSeverity={selectedSeverity}
            onSelectSeverity={setSelectedSeverity}
          />
        </CardContent>
      </Card>

      {/* Filter and Search Toolbar */}
      <Card className="border-border/80 bg-card/60">
        <CardContent className="p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_200px_160px]">
            {/* Search Input */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search messages, trace IDs, errors..."
                className="h-9 pl-9 pr-8 text-xs font-mono"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-500 hover:text-slate-200"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            {/* Service Filter */}
            <div>
              <label htmlFor="service-filter" className="sr-only">
                Filter by service
              </label>
              <select
                id="service-filter"
                value={selectedServiceId}
                onChange={(e) => setSelectedServiceId(e.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-background/80 px-3 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400"
              >
                <option value="">All Services ({services.length})</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.service_key})
                  </option>
                ))}
              </select>
            </div>

            {/* Severity Filter */}
            <div>
              <label htmlFor="severity-filter" className="sr-only">
                Filter by severity
              </label>
              <select
                id="severity-filter"
                value={selectedSeverity ?? ''}
                onChange={(e) =>
                  setSelectedSeverity(e.target.value ? (e.target.value as LogSeverity) : undefined)
                }
                className="h-9 w-full rounded-lg border border-input bg-background/80 px-3 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400 font-mono"
              >
                <option value="">All Severities</option>
                <option value="FATAL">FATAL</option>
                <option value="ERROR">ERROR</option>
                <option value="WARN">WARN</option>
                <option value="INFO">INFO</option>
                <option value="DEBUG">DEBUG</option>
              </select>
            </div>
          </div>

          {/* Active Filter Pills Bar */}
          {hasActiveFilters && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-2.5 text-xs text-slate-400">
              <span className="text-[11px] font-medium text-slate-500">Active filters:</span>

              {selectedSeverity && (
                <span className="inline-flex items-center gap-1 rounded bg-sky-400/10 px-2 py-0.5 text-[11px] font-semibold text-sky-300 border border-sky-400/20">
                  Severity: {selectedSeverity}
                  <button type="button" onClick={() => setSelectedSeverity(undefined)}>
                    <X className="size-3 hover:text-white" />
                  </button>
                </span>
              )}

              {selectedServiceId && (
                <span className="inline-flex items-center gap-1 rounded bg-sky-400/10 px-2 py-0.5 text-[11px] font-semibold text-sky-300 border border-sky-400/20">
                  Service: {services.find((s) => s.id === selectedServiceId)?.name ?? selectedServiceId}
                  <button type="button" onClick={() => setSelectedServiceId('')}>
                    <X className="size-3 hover:text-white" />
                  </button>
                </span>
              )}

              {traceIdFilter && (
                <span className="inline-flex items-center gap-1 rounded bg-violet-400/10 px-2 py-0.5 text-[11px] font-mono text-violet-300 border border-violet-400/20">
                  Trace: {traceIdFilter}
                  <button type="button" onClick={() => setTraceIdFilter('')}>
                    <X className="size-3 hover:text-white" />
                  </button>
                </span>
              )}

              {debouncedQuery && (
                <span className="inline-flex items-center gap-1 rounded bg-white/[0.08] px-2 py-0.5 text-[11px] text-slate-200">
                  Query: “{debouncedQuery}”
                  <button type="button" onClick={() => setSearch('')}>
                    <X className="size-3 hover:text-white" />
                  </button>
                </span>
              )}

              <button
                type="button"
                onClick={clearAllFilters}
                className="ml-auto text-[11px] text-sky-300 underline underline-offset-4 hover:text-sky-200"
              >
                Clear all filters
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Logs Table / Console */}
      <Card className="overflow-hidden border-border/80">
        <div className="flex items-center justify-between border-b border-border/80 bg-black/30 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-emerald-400" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Log Stream Console
            </h2>
            <span className="text-xs text-slate-500">
              (Showing {logs.length} events)
            </span>
          </div>

          <div className="text-xs text-slate-500 font-mono">
            Click row to inspect attributes & traces
          </div>
        </div>

        {error ? (
          <div className="p-8 text-center text-sm text-rose-300">
            <p>{error}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setRefreshTrigger((prev) => prev + 1)}
              className="mt-3"
            >
              Retry
            </Button>
          </div>
        ) : loading && logs.length === 0 ? (
          <div className="p-5">
            <LogSkeleton rows={8} />
          </div>
        ) : logs.length === 0 ? (
          <div className="p-5">
            <LogEmptyState
              hasFilters={hasActiveFilters}
              onClearFilters={clearAllFilters}
              onSeedDemoLogs={services.length > 0 ? handleSeedSampleLogs : undefined}
              seeding={seeding}
            />
          </div>
        ) : (
          <>
            {/* Table Header */}
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead>
                  <tr className="border-b border-border/80 bg-white/[0.015] text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="w-48 px-4 py-2.5 font-semibold">Timestamp</th>
                    <th className="w-24 px-3 py-2.5 font-semibold">Severity</th>
                    <th className="w-36 px-3 py-2.5 font-semibold">Service</th>
                    <th className="px-4 py-2.5 font-semibold">Message</th>
                    <th className="w-32 px-3 py-2.5 font-semibold">Trace ID</th>
                    <th className="w-10 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {logs.map((log) => {
                    const times = formatLogTime(log.timestamp)
                    return (
                      <tr
                        key={log.id}
                        onClick={() => handleOpenLog(log)}
                        className="group cursor-pointer hover:bg-white/[0.04] transition-colors"
                      >
                        {/* Timestamp */}
                        <td className="whitespace-nowrap px-4 py-2.5 text-slate-400 font-medium">
                          <span title={times.utc}>{times.local}</span>
                        </td>

                        {/* Severity */}
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <LogSeverityBadge severity={log.severity} />
                        </td>

                        {/* Service */}
                        <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-slate-300">
                          <span
                            className="truncate block max-w-[140px]"
                            title={log.service?.name ?? log.service_id}
                          >
                            {log.service?.name ?? log.service_id.slice(0, 8)}
                          </span>
                        </td>

                        {/* Message Snippet */}
                        <td className="px-4 py-2.5 text-slate-200">
                          <div className="flex items-center gap-2">
                            <span className="line-clamp-1 break-all font-mono leading-relaxed">
                              {log.message}
                            </span>
                            {Object.keys(log.attributes || {}).length > 0 && (
                              <span className="rounded bg-white/[0.05] px-1 py-0.2 text-[10px] text-slate-500 border border-border/50 shrink-0">
                                {Object.keys(log.attributes).length} attrs
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Trace ID */}
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-400">
                          {log.trace_id ? (
                            <span
                              className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-300 border border-sky-500/20"
                              title={`Trace: ${log.trace_id}`}
                            >
                              {log.trace_id.slice(0, 12)}
                            </span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>

                        {/* Action icon */}
                        <td className="px-3 py-2.5 text-right text-slate-500 group-hover:text-slate-200">
                          <ChevronRight className="size-3.5 inline-block" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex flex-col gap-3 border-t border-border/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p className="text-xs text-slate-500">
                Showing {logs.length} logs {cursorStack.length > 0 ? `· page ${cursorStack.length + 1}` : ''}
              </p>

              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={cursorStack.length === 0 || loading}
                  onClick={handlePrevPage}
                >
                  <ArrowLeft className="size-3.5" /> Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!logsData?.page.has_more || loading}
                  onClick={handleNextPage}
                >
                  Next <ArrowRight className="size-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* Log Detail Drawer */}
      <LogDrawer
        log={selectedLog}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onFilterByTrace={(traceId) => {
          setTraceIdFilter(traceId)
          setCursor(null)
          setCursorStack([])
        }}
      />
    </div>
  )
}
