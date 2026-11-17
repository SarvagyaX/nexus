import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Plus, Search, Server, ShieldCheck, X } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Card, CardHeader, CardTitle } from '../components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { useAuth } from '../features/auth/auth-context'
import { ServiceApiError, servicesApi } from '../features/services/api'
import { ServiceForm } from '../features/services/service-form'
import { ServiceEmpty, ServiceError, ServiceSkeletons, StatTile, StatusBadge } from '../features/services/service-ui'
import type { Service, ServiceInput, ServiceListResponse, ServiceStatus } from '../features/services/types'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The request could not be completed. Please retry.'
}

function ServiceRow({ service }: { service: Service }) {
  return <tr className="group border-t border-border/70 transition-colors hover:bg-white/[0.025]">
    <td className="min-w-[220px] px-5 py-4"><Link to={`/services/${service.id}`} className="font-medium text-slate-100 underline-offset-4 hover:text-sky-200 hover:underline">{service.name}</Link><p className="mt-1 font-mono text-xs text-slate-500">{service.service_key}</p>{service.description && <p className="mt-2 line-clamp-1 max-w-sm text-xs text-slate-500">{service.description}</p>}</td>
    <td className="px-4 py-4 text-sm text-slate-300">{service.environment || '—'}</td>
    <td className="px-4 py-4 text-sm text-slate-300">{service.owner_team || '—'}</td>
    <td className="px-4 py-4"><StatusBadge status={service.status} /></td>
    <td className="whitespace-nowrap px-5 py-4 text-xs text-slate-500">{new Date(service.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
  </tr>
}

export function ServicesPage() {
  const { activeWorkspaceId, workspaces, csrfToken } = useAuth()
  const role = workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.role
  const canManage = role === 'admin'
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | ServiceStatus>('all')
  const [cursor, setCursor] = useState<string | null>(null)
  const [previousCursors, setPreviousCursors] = useState<Array<string | null>>([])
  const [pageData, setPageData] = useState<ServiceListResponse | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [listVersion, setListVersion] = useState(0)
  const [allServices, setAllServices] = useState<Service[] | null>(null)
  const [countsLoading, setCountsLoading] = useState(true)
  const [countsError, setCountsError] = useState<string | null>(null)
  const [countsVersion, setCountsVersion] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<ServiceApiError | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    setCursor(null)
    setPreviousCursors([])
  }, [activeWorkspaceId, statusFilter, query])

  useEffect(() => {
    if (!activeWorkspaceId) return
    const controller = new AbortController()
    setListLoading(true)
    setListError(null)
    setPageData(null)
    void servicesApi.list(activeWorkspaceId, {
      status: statusFilter === 'all' ? undefined : statusFilter,
      q: query || undefined,
      limit: 25,
      cursor,
    }, controller.signal).then((response) => {
      setPageData(response)
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setListError(errorMessage(error))
    }).finally(() => {
      if (!controller.signal.aborted) setListLoading(false)
    })
    return () => controller.abort()
  }, [activeWorkspaceId, statusFilter, query, cursor, listVersion])

  useEffect(() => {
    if (!activeWorkspaceId) return
    const controller = new AbortController()
    setCountsLoading(true)
    setCountsError(null)
    setAllServices(null)
    void servicesApi.all(activeWorkspaceId, controller.signal).then(setAllServices).catch((error: unknown) => {
      if (!controller.signal.aborted) setCountsError(errorMessage(error))
    }).finally(() => {
      if (!controller.signal.aborted) setCountsLoading(false)
    })
    return () => controller.abort()
  }, [activeWorkspaceId, countsVersion])

  const counts = useMemo(() => ({
    total: allServices?.length ?? null,
    active: allServices?.filter((service) => service.status === 'active').length ?? null,
    archived: allServices?.filter((service) => service.status === 'archived').length ?? null,
  }), [allServices])

  const reload = useCallback(() => {
    setListVersion((value) => value + 1)
    setCountsVersion((value) => value + 1)
  }, [])

  async function createService(payload: ServiceInput) {
    if (!activeWorkspaceId || !csrfToken) {
      setCreateError(new ServiceApiError('Your session is missing its security token. Refresh and sign in again.', 401, 'session_unavailable'))
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      await servicesApi.create(activeWorkspaceId, payload, csrfToken)
      setCreateOpen(false)
      setCursor(null)
      setPreviousCursors([])
      reload()
    } catch (error) {
      setCreateError(error instanceof ServiceApiError ? error : new ServiceApiError(errorMessage(error), 0, 'request_failed'))
    } finally {
      setCreating(false)
    }
  }

  if (!activeWorkspaceId) {
    return <div role="alert" className="mx-auto max-w-3xl rounded-xl border border-amber-300/20 bg-amber-300/[0.04] p-5 text-sm text-amber-100">No active workspace is available for the service registry.</div>
  }

  const services = pageData?.items ?? []
  const hasFilters = Boolean(query) || statusFilter !== 'all'

  return (
    <div className="mx-auto max-w-[1440px] space-y-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em]"><span className="text-sky-300">Workspace</span><span className="text-slate-700">/</span><span className="text-slate-500">Registry</span></div>
          <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-slate-100 sm:text-[34px]">Services</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">A workspace-scoped catalog of owned services and their operating context.</p>
        </div>
        {canManage && <Button onClick={() => { setCreateError(null); setCreateOpen(true) }}><Plus className="size-4" /> Add service</Button>}
      </div>

      <section aria-label="Service totals" className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Total services" value={countsLoading ? null : countsError ? undefined : counts.total} detail="Across this workspace" tone="blue" />
        <StatTile label="Active" value={countsLoading ? null : countsError ? undefined : counts.active} detail="Available in the registry" tone="green" />
        <StatTile label="Archived" value={countsLoading ? null : countsError ? undefined : counts.archived} detail="Kept for historical context" tone="slate" />
      </section>
      {countsError && <ServiceError message={countsError} onRetry={() => setCountsVersion((value) => value + 1)} />}

      <Card className="overflow-hidden">
        <CardHeader className="gap-4 border-b border-border/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div><CardTitle className="text-[15px]">Service catalog</CardTitle><p className="mt-1 text-xs text-muted-foreground">Search by name or key and filter by lifecycle status.</p></div>
          <div className="grid gap-2 sm:grid-cols-[minmax(190px,1fr)_150px]">
            <label className="relative block"><span className="sr-only">Search services</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" /><Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search services" className="h-9 pl-9 pr-8" /><button type="button" aria-label="Clear search" onClick={() => setSearch('')} className={`absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-slate-200 ${search ? '' : 'invisible'}`}><X className="size-3.5" /></button></label>
            <label className="sr-only" htmlFor="service-status">Filter by status</label><select id="service-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | ServiceStatus)} className="h-9 rounded-lg border border-input bg-background/70 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/30"><option value="all">All statuses</option><option value="active">Active</option><option value="archived">Archived</option></select>
          </div>
        </CardHeader>
        {listError ? <div className="p-4 sm:p-5"><ServiceError message={listError} onRetry={() => setListVersion((value) => value + 1)} /></div> : listLoading && !pageData ? <div className="p-4 sm:p-5"><ServiceSkeletons /></div> : services.length === 0 ? <div className="p-4 sm:p-5"><ServiceEmpty hasFilters={hasFilters} onClear={() => { setSearch(''); setStatusFilter('all') }} /></div> : <>
          {listLoading && <div className="h-0.5 overflow-hidden bg-slate-800"><div className="h-full w-1/3 animate-pulse bg-sky-400" /></div>}
          <div className="hidden overflow-x-auto md:block"><table className="w-full text-left"><thead><tr className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"><th className="px-5 py-3">Service</th><th className="px-4 py-3">Environment</th><th className="px-4 py-3">Team</th><th className="px-4 py-3">Status</th><th className="px-5 py-3">Updated</th></tr></thead><tbody>{services.map((service) => <ServiceRow key={service.id} service={service} />)}</tbody></table></div>
          <div className="divide-y divide-border/70 md:hidden">{services.map((service) => <article key={service.id} className="space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><Link to={`/services/${service.id}`} className="font-medium text-slate-100 underline-offset-4 hover:text-sky-200 hover:underline">{service.name}</Link><p className="mt-1 font-mono text-xs text-slate-500">{service.service_key}</p></div><StatusBadge status={service.status} /></div>{service.description && <p className="line-clamp-2 text-xs leading-5 text-slate-400">{service.description}</p>}<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500"><span>{service.environment || 'Environment not set'}</span><span>{service.owner_team || 'No owning team'}</span><span>Updated {new Date(service.updated_at).toLocaleDateString()}</span></div></article>)}</div>
          <div className="flex flex-col gap-3 border-t border-border/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"><p className="text-xs text-slate-500">Showing {services.length} services{query ? ` matching “${query}”` : ''}{statusFilter !== 'all' ? ` · ${statusFilter}` : ''}</p><div className="flex items-center gap-2"><Button variant="secondary" size="sm" disabled={previousCursors.length === 0 || listLoading} onClick={() => { const next = [...previousCursors]; const previous = next.pop() ?? null; setPreviousCursors(next); setCursor(previous) }}><ArrowLeft className="size-3.5" /> Previous</Button><Button variant="secondary" size="sm" disabled={!pageData?.page.has_more || listLoading} onClick={() => { if (pageData?.page.next_cursor) { setPreviousCursors((current) => [...current, cursor]); setCursor(pageData.page.next_cursor) } }}>Next <ArrowRight className="size-3.5" /></Button></div></div>
        </>}
      </Card>

      {!canManage && <p className="flex items-center gap-2 text-xs text-slate-500"><ShieldCheck className="size-3.5" /> Service changes are available to workspace administrators.</p>}

      <Dialog open={createOpen} onOpenChange={(open) => { if (!creating) { setCreateOpen(open); if (!open) setCreateError(null) } }}>
        <DialogContent className="top-[5vh] max-h-[90vh] max-w-2xl overflow-y-auto p-0">
          <div className="border-b border-border px-5 py-5 pr-12 sm:px-6"><div className="mb-2 flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-sky-400/10 text-sky-200"><Server className="size-4" /></span><Badge variant="muted">Workspace service</Badge></div><DialogTitle className="text-xl text-slate-100">Register a service</DialogTitle><DialogDescription className="mt-1.5">Add ownership and repository context to the service catalog.</DialogDescription></div>
          <div className="p-5 sm:p-6"><ServiceForm busy={creating} error={createError} onSubmit={(payload) => createService(payload as ServiceInput)} onCancel={() => setCreateOpen(false)} /></div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
