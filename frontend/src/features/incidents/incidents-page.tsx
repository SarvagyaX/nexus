import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, ArrowLeft, ArrowRight, CirclePlus, Search, ShieldAlert, X } from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { useAuth } from '../auth/auth-context'
import { servicesApi } from '../services/api'
import type { Service } from '../services/types'
import { IncidentApiError, incidentsApi } from './api'
import { IncidentCreateDialog } from './incident-create-dialog'
import { ApiErrorPanel, IncidentSkeleton, IncidentStatusBadge, LoadingMetric, SeverityBadge, formatTimestamp } from './incident-ui'
import type { Incident, IncidentListResponse, IncidentSeverity, IncidentStatus } from './types'

const statuses: Array<'all' | IncidentStatus> = ['all', 'open', 'investigating', 'monitoring', 'resolved']
const severityOrder: IncidentSeverity[] = ['SEV1', 'SEV2', 'SEV3', 'SEV4']

function getStatus(error: unknown) { return error instanceof IncidentApiError ? error.status : undefined }
function getMessage(error: unknown) { return error instanceof Error ? error.message : 'The request could not be completed. Retry to try again.' }

function IncidentTable({ incidents }: { incidents: Incident[] }) {
  if (!incidents.length) return null
  return <>
    <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[810px] text-left"><thead><tr className="border-b border-border/70 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"><th className="px-5 py-3">Incident</th><th className="px-4 py-3">Service</th><th className="px-4 py-3">Severity</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Assignee</th><th className="px-5 py-3">Created / updated</th></tr></thead><tbody>{incidents.map((incident) => <tr key={incident.id} className="group border-b border-border/55 last:border-0 transition-colors hover:bg-white/[0.025]"><td className="min-w-[230px] px-5 py-4"><Link to={`/incidents/${incident.id}`} className="font-medium text-slate-100 underline-offset-4 hover:text-sky-200 hover:underline">{incident.title}</Link><p className="mt-1 font-mono text-[11px] text-slate-500">{incident.reference}</p></td><td className="px-4 py-4"><span className="block text-sm text-slate-300">{incident.service?.name ?? 'Unknown service'}</span><span className="mt-1 block font-mono text-[10px] text-slate-500">{incident.service?.service_key ?? '—'}</span></td><td className="px-4 py-4"><SeverityBadge severity={incident.severity} /></td><td className="px-4 py-4"><IncidentStatusBadge status={incident.status} /></td><td className="px-4 py-4 text-sm text-slate-400">{incident.assignee?.display_name ?? 'Unassigned'}</td><td className="whitespace-nowrap px-5 py-4 text-xs text-slate-400"><span className="block" title={formatTimestamp(incident.created_at)}>{formatTimestamp(incident.created_at)}</span><span className="mt-1 block text-[10px] text-slate-500" title={formatTimestamp(incident.updated_at)}>Updated {formatTimestamp(incident.updated_at)}</span></td></tr>)}</tbody></table></div>
    <div className="divide-y divide-border/60 md:hidden">{incidents.map((incident) => <article key={incident.id} className="space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><Link to={`/incidents/${incident.id}`} className="font-medium text-slate-100 underline-offset-4 hover:text-sky-200 hover:underline">{incident.title}</Link><p className="mt-1 font-mono text-[11px] text-slate-500">{incident.reference}</p></div><SeverityBadge severity={incident.severity} /></div><div className="flex flex-wrap items-center gap-2"><IncidentStatusBadge status={incident.status} /><span className="text-xs text-slate-500">{incident.service?.name ?? 'Unknown service'}</span></div><div className="flex items-center justify-between gap-3 text-xs text-slate-500"><span>{incident.assignee?.display_name ?? 'Unassigned'}</span><span>{formatTimestamp(incident.updated_at)}</span></div></article>)}</div>
  </>
}

function SummaryCard({ label, value, tone, loading, icon: Icon, detail }: { label: string; value?: number; tone: string; loading: boolean; icon: typeof Activity; detail: string }) {
  return <Card><CardContent className="p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-medium text-slate-400">{label}</p><p className="mt-3 min-h-[32px] text-[28px] font-semibold leading-none tracking-[-0.04em] text-slate-100">{loading ? <LoadingMetric /> : value?.toLocaleString() ?? '—'}</p></div><span className={`grid size-9 shrink-0 place-items-center rounded-lg ${tone}`}><Icon className="size-[17px]" /></span></div><p className="mt-3 truncate text-[11px] text-slate-500">{detail}</p></CardContent></Card>
}

export function IncidentsPage() {
  const { activeWorkspaceId, workspaces, user, csrfToken } = useAuth()
  const role = workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.role
  const canWrite = role === 'admin' || role === 'commander' || role === 'responder'
  const demoWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.slug === 'nexus-demo'
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | IncidentStatus>('all')
  const [severityFilter, setSeverityFilter] = useState<'all' | IncidentSeverity>('all')
  const [serviceFilter, setServiceFilter] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([])
  const [page, setPage] = useState<IncidentListResponse | null>(null)
  const [pageLoading, setPageLoading] = useState(true)
  const [pageError, setPageError] = useState<unknown>(null)
  const [overview, setOverview] = useState<Incident[] | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(true)
  const [overviewError, setOverviewError] = useState<unknown>(null)
  const [services, setServices] = useState<Service[]>([])
  const [servicesLoading, setServicesLoading] = useState(true)
  const [servicesError, setServicesError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<IncidentApiError | null>(null)

  useEffect(() => { const timer = window.setTimeout(() => setQuery(search.trim()), 250); return () => window.clearTimeout(timer) }, [search])
  useEffect(() => { setCursor(null); setCursorStack([]) }, [activeWorkspaceId, statusFilter, severityFilter, serviceFilter, assigneeFilter, query])

  useEffect(() => {
    if (!activeWorkspaceId) { setOverview([]); setOverviewLoading(false); setOverviewError(null); return }
    const controller = new AbortController()
    setOverviewLoading(true); setOverviewError(null); setOverview(null)
    void incidentsApi.all(activeWorkspaceId, controller.signal).then(setOverview).catch((error: unknown) => {
      if (!controller.signal.aborted) setOverviewError(error)
    }).finally(() => { if (!controller.signal.aborted) setOverviewLoading(false) })
    return () => controller.abort()
  }, [activeWorkspaceId, refresh])

  useEffect(() => {
    if (!activeWorkspaceId) { setServices([]); setServicesLoading(false); return }
    const controller = new AbortController()
    setServicesLoading(true); setServicesError(null)
    void servicesApi.all(activeWorkspaceId, controller.signal).then(setServices).catch((error: unknown) => {
      if (!controller.signal.aborted) setServicesError(getMessage(error))
    }).finally(() => { if (!controller.signal.aborted) setServicesLoading(false) })
    return () => controller.abort()
  }, [activeWorkspaceId])

  useEffect(() => {
    if (!activeWorkspaceId) { setPage(null); setPageLoading(false); return }
    const controller = new AbortController()
    setPageLoading(true); setPageError(null)
    void incidentsApi.list(activeWorkspaceId, {
      status: statusFilter === 'all' ? undefined : statusFilter,
      severity: severityFilter === 'all' ? undefined : severityFilter,
      service_id: serviceFilter || undefined,
      assignee_user_id: assigneeFilter || undefined,
      q: query || undefined, limit: 25, cursor,
    }, controller.signal).then(setPage).catch((error: unknown) => {
      if (!controller.signal.aborted) setPageError(error)
    }).finally(() => { if (!controller.signal.aborted) setPageLoading(false) })
    return () => controller.abort()
  }, [activeWorkspaceId, statusFilter, severityFilter, serviceFilter, assigneeFilter, query, cursor, refresh])

  const counts = useMemo(() => {
    const records = overview ?? []
    return {
      total: records.length,
      open: records.filter((item) => item.status === 'open').length,
      investigating: records.filter((item) => item.status === 'investigating').length,
      monitoring: records.filter((item) => item.status === 'monitoring').length,
      resolved: records.filter((item) => item.status === 'resolved').length,
      severity: Object.fromEntries(severityOrder.map((severity) => [severity, records.filter((item) => item.severity === severity).length])) as Record<IncidentSeverity, number>,
    }
  }, [overview])
  const assignees = useMemo(() => {
    const values = new Map<string, string>()
    if (user) values.set(user.id, `${user.display_name} (you)`)
    for (const item of overview ?? []) if (item.assignee) values.set(item.assignee.id, item.assignee.display_name)
    return [...values.entries()].sort((left, right) => left[1].localeCompare(right[1]))
  }, [overview, user])

  async function createIncident(payload: Parameters<typeof incidentsApi.create>[1]) {
    if (!activeWorkspaceId || !csrfToken) {
      setCreateError(new IncidentApiError('Your session is missing its security token. Refresh and sign in again.', 401, 'session_unavailable'))
      return
    }
    setCreating(true); setCreateError(null)
    try {
      await incidentsApi.create(activeWorkspaceId, payload, csrfToken)
      setCreateOpen(false); setCursor(null); setCursorStack([]); setRefresh((value) => value + 1)
    } catch (error) {
      setCreateError(error instanceof IncidentApiError ? error : new IncidentApiError(getMessage(error), 0, 'request_failed'))
    } finally { setCreating(false) }
  }

  const items = page?.items ?? []
  const filtersActive = Boolean(query || serviceFilter || assigneeFilter || statusFilter !== 'all' || severityFilter !== 'all')
  const clearFilters = () => { setSearch(''); setQuery(''); setStatusFilter('all'); setSeverityFilter('all'); setServiceFilter(''); setAssigneeFilter('') }
  const summaryError = overviewError ? <p className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/[0.04] px-3 py-2 text-xs text-rose-200">Incident totals unavailable: {getMessage(overviewError)}</p> : null

  if (!activeWorkspaceId) return <div role="alert" className="mx-auto max-w-3xl rounded-xl border border-amber-300/20 bg-amber-300/[0.04] p-5 text-sm text-amber-100">No active workspace is available.</div>

  return <div className="mx-auto max-w-[1440px] space-y-6 sm:space-y-7">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em]"><span className="text-sky-300">Operations</span><span className="text-slate-700">/</span><span className="text-slate-500">Incident command</span>{demoWorkspace && <Badge variant="violet" className="ml-1 text-[9px] uppercase tracking-[0.08em]">Demo data</Badge>}</div><h1 className="text-[28px] font-semibold tracking-[-0.04em] text-slate-100 sm:text-[34px]">Incidents</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Triage, coordinate response, and review the timeline of workspace incidents.</p></div>
      {canWrite && <Button onClick={() => { setCreateError(null); setCreateOpen(true) }}><CirclePlus className="size-4" /> Create incident</Button>}
    </div>

    <section aria-label="Incident totals" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <SummaryCard label="Total incidents" value={overview ? counts.total : undefined} loading={overviewLoading} tone="bg-sky-400/10 text-sky-200" icon={Activity} detail="Across this workspace" />
      <SummaryCard label="Open" value={overview ? counts.open : undefined} loading={overviewLoading} tone="bg-blue-400/10 text-blue-200" icon={CirclePlus} detail="Awaiting investigation" />
      <SummaryCard label="Investigating" value={overview ? counts.investigating : undefined} loading={overviewLoading} tone="bg-rose-400/10 text-rose-200" icon={ShieldAlert} detail="Response in progress" />
      <SummaryCard label="Monitoring" value={overview ? counts.monitoring : undefined} loading={overviewLoading} tone="bg-amber-400/10 text-amber-200" icon={Activity} detail="Watching for recurrence" />
      <SummaryCard label="Resolved" value={overview ? counts.resolved : undefined} loading={overviewLoading} tone="bg-emerald-400/10 text-emerald-200" icon={Activity} detail="Closed incident records" />
    </section>
    {summaryError}

    <Card><CardHeader className="gap-4 border-b border-border/70 px-4 py-4 sm:px-5"><div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><CardTitle className="text-[15px]">Severity distribution</CardTitle><p className="mt-1 text-xs text-muted-foreground">Counts from persisted incidents in this workspace.</p></div><span className="text-[11px] text-slate-500">{overviewLoading ? 'Loading totals…' : overviewError ? 'Unavailable' : `${counts.total.toLocaleString()} incident${counts.total === 1 ? '' : 's'}`}</span></div>
      {!overviewError && <div className="grid gap-3 sm:grid-cols-4">{severityOrder.map((severity) => <div key={severity} className="rounded-lg border border-border/70 bg-white/[0.018] p-3.5"><div className="flex items-center justify-between gap-3"><SeverityBadge severity={severity} />{overviewLoading ? <LoadingMetric /> : <span className="font-mono text-sm font-semibold text-slate-200">{counts.severity[severity].toLocaleString()}</span>}</div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className={`h-full rounded-full transition-[width] duration-500 ${severity === 'SEV1' ? 'bg-rose-400' : severity === 'SEV2' ? 'bg-amber-300' : severity === 'SEV3' ? 'bg-violet-300' : 'bg-slate-400'}`} style={{ width: overviewLoading || !counts.total ? '0%' : `${Math.max(counts.severity[severity] / counts.total * 100, counts.severity[severity] ? 3 : 0)}%` }} /></div><p className="mt-2 text-[11px] text-slate-500">{overviewLoading || !counts.total ? '—' : `${(counts.severity[severity] / counts.total * 100).toFixed(0)}% of incidents`}</p></div>)}</div>}
    </CardHeader></Card>

    <Card className="overflow-hidden"><CardHeader className="gap-4 border-b border-border/70 px-4 py-4 sm:px-5"><div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><CardTitle className="text-[15px]">Incident queue</CardTitle><p className="mt-1 text-xs text-muted-foreground">Search and filter incident records. Results use stable cursor pagination.</p></div><span className="text-[11px] text-slate-500">{page?.page.has_more ? 'More results available' : page ? `${items.length} on this page` : ''}</span></div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(190px,1fr)_155px_145px_165px_175px]">
        <label className="relative block"><span className="sr-only">Search incidents</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" /><Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title or reference" className="h-9 pl-9 pr-8" /><button type="button" aria-label="Clear search" onClick={() => setSearch('')} className={`absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-slate-200 ${search ? '' : 'invisible'}`}><X className="size-3.5" /></button></label>
        <label className="sr-only" htmlFor="incident-status-filter">Filter by status</label><select id="incident-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | IncidentStatus)} className="h-9 rounded-lg border border-input bg-background/70 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/30">{statuses.map((status) => <option key={status} value={status}>{status === 'all' ? 'All statuses' : status.replace('_', ' ')}</option>)}</select>
        <label className="sr-only" htmlFor="incident-severity-filter">Filter by severity</label><select id="incident-severity-filter" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as 'all' | IncidentSeverity)} className="h-9 rounded-lg border border-input bg-background/70 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/30"><option value="all">All severity</option>{severityOrder.map((severity) => <option key={severity} value={severity}>{severity}</option>)}</select>
        <label className="sr-only" htmlFor="incident-service-filter">Filter by service</label><select id="incident-service-filter" value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)} className="h-9 rounded-lg border border-input bg-background/70 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/30"><option value="">All services</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select>
        <label className="sr-only" htmlFor="incident-assignee-filter">Filter by assignee</label><select id="incident-assignee-filter" value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)} className="h-9 rounded-lg border border-input bg-background/70 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/30"><option value="">All assignees</option>{assignees.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      </div>
      {servicesError && <p role="status" className="text-xs text-amber-200">Service filter options could not be loaded: {servicesError}</p>}
    </CardHeader>

      {pageError ? <div className="p-4 sm:p-5"><ApiErrorPanel message={getMessage(pageError)} status={getStatus(pageError)} onRetry={() => setRefresh((value) => value + 1)} /></div> : pageLoading && !page ? <div className="p-4 sm:p-5"><IncidentSkeleton /></div> : items.length === 0 ? <div className="px-5 py-12 text-center"><span className="mx-auto grid size-10 place-items-center rounded-xl border border-border bg-white/[0.025] text-slate-500"><Activity className="size-4" /></span><h3 className="mt-4 text-sm font-semibold text-slate-200">{filtersActive ? 'No incidents match these filters' : 'No incidents yet'}</h3><p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-slate-500">{filtersActive ? 'Adjust the filters or clear them to see more incidents.' : 'Create an incident to start coordinating a response for a registered service.'}</p>{filtersActive && <Button variant="ghost" size="sm" onClick={clearFilters} className="mt-3 text-sky-300">Clear filters</Button>}{!filtersActive && canWrite && <Button size="sm" onClick={() => setCreateOpen(true)} className="mt-4"><CirclePlus className="size-4" /> Create incident</Button>}</div> : <>
        {pageLoading && <div className="h-0.5 overflow-hidden bg-slate-800"><div className="h-full w-1/3 animate-pulse bg-sky-400" /></div>}
        <IncidentTable incidents={items} />
        <div className="flex flex-col gap-3 border-t border-border/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"><p className="text-xs text-slate-500">Showing {items.length} of the current page{query ? ` matching “${query}”` : ''}</p><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={!cursorStack.length || pageLoading} onClick={() => { const previous = [...cursorStack]; const value = previous.pop() ?? null; setCursorStack(previous); setCursor(value) }}><ArrowLeft className="size-3.5" /> Previous</Button><Button variant="outline" size="sm" disabled={!page?.page.has_more || !page.page.next_cursor || pageLoading} onClick={() => { if (!page?.page.next_cursor) return; setCursorStack((values) => [...values, cursor]); setCursor(page.page.next_cursor) }}>Next <ArrowRight className="size-3.5" /></Button></div></div>
      </>}
    </Card>

    <IncidentCreateDialog key={createOpen ? 'create-open' : 'create-closed'} open={createOpen} services={services} servicesLoading={servicesLoading} servicesError={servicesError} busy={creating} error={createError} onOpenChange={setCreateOpen} onSubmit={createIncident} />
  </div>
}
