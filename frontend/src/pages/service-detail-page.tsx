import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Archive, Check, ExternalLink, LoaderCircle, Pencil, Server } from 'lucide-react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog'
import { useAuth } from '../features/auth/auth-context'
import { ServiceApiError, servicesApi } from '../features/services/api'
import { ServiceForm } from '../features/services/service-form'
import { ServiceError, ServiceSkeletons, ServiceMetadata, StatusBadge } from '../features/services/service-ui'
import type { Service, ServiceInput, ServicePatch, ServiceStatus } from '../features/services/types'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The request could not be completed. Please retry.'
}

export function ServiceDetailPage() {
  const { serviceId } = useParams()
  const { activeWorkspaceId, workspaces, csrfToken } = useAuth()
  const role = workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.role
  const canManage = role === 'admin'
  const [service, setService] = useState<Service | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadVersion, setLoadVersion] = useState(0)
  const [editOpen, setEditOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<ServiceApiError | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeWorkspaceId || !serviceId) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setService(null)
    void servicesApi.get(activeWorkspaceId, serviceId, controller.signal).then(setService).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(cause))
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [activeWorkspaceId, serviceId, loadVersion])

  async function updateService(payload: ServiceInput | ServicePatch) {
    if (!activeWorkspaceId || !serviceId || !csrfToken) {
      setEditError(new ServiceApiError('Your session is missing its security token. Refresh and sign in again.', 401, 'session_unavailable'))
      return
    }
    setSaving(true)
    setEditError(null)
    try {
      const updated = await servicesApi.update(activeWorkspaceId, serviceId, payload as ServicePatch, csrfToken)
      setService(updated)
      setEditOpen(false)
    } catch (cause) {
      setEditError(cause instanceof ServiceApiError ? cause : new ServiceApiError(errorMessage(cause), 0, 'request_failed'))
    } finally {
      setSaving(false)
    }
  }

  async function changeStatus(status: ServiceStatus) {
    if (!activeWorkspaceId || !serviceId || !csrfToken) {
      setStatusError('Your session is missing its security token. Refresh and sign in again.')
      return
    }
    setStatusBusy(true)
    setStatusError(null)
    try {
      const updated = await servicesApi.update(activeWorkspaceId, serviceId, { status }, csrfToken)
      setService(updated)
      setArchiveOpen(false)
    } catch (cause) {
      setStatusError(errorMessage(cause))
    } finally {
      setStatusBusy(false)
    }
  }

  if (!activeWorkspaceId) return <ServiceError message="No active workspace is available for this service." onRetry={() => setLoadVersion((value) => value + 1)} />

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link to="/services" className="inline-flex items-center gap-2 rounded-md text-sm text-slate-400 transition-colors hover:text-sky-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="size-4" /> Back to services</Link>

      {loading && !service ? <ServiceSkeletons /> : error || !service ? <ServiceError message={error ?? 'Service was not found.'} onRetry={() => setLoadVersion((value) => value + 1)} /> : <>
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3.5">
            <span className="mt-1 grid size-11 shrink-0 place-items-center rounded-xl border border-sky-400/20 bg-sky-400/[0.08] text-sky-200"><Server className="size-5" /></span>
            <div className="min-w-0"><div className="mb-2 flex flex-wrap items-center gap-2"><span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">Service details</span><StatusBadge status={service.status} /></div><h1 className="break-words text-[27px] font-semibold tracking-[-0.04em] text-slate-100 sm:text-[34px]">{service.name}</h1><p className="mt-1.5 font-mono text-sm text-slate-400">{service.service_key}</p></div>
          </div>
          {canManage && <div className="flex flex-wrap gap-2 sm:justify-end"><Button variant="secondary" onClick={() => { setEditError(null); setEditOpen(true) }}><Pencil className="size-4" /> Edit service</Button>{service.status === 'active' ? <Button variant="outline" className="text-amber-200 hover:text-amber-100" onClick={() => { setStatusError(null); setArchiveOpen(true) }}><Archive className="size-4" /> Archive</Button> : <Button onClick={() => void changeStatus('active')} disabled={statusBusy}>{statusBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />} Reactivate</Button>}</div>}
        </header>

        {statusError && !archiveOpen && <ServiceError message={statusError} onRetry={() => void changeStatus(service.status === 'active' ? 'archived' : 'active')} />}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,0.8fr)]">
          <Card>
            <CardHeader className="border-b border-border/70 px-5 py-4 sm:px-6"><CardTitle className="text-[15px]">Service overview</CardTitle></CardHeader>
            <CardContent className="space-y-6 p-5 sm:p-6"><p className="whitespace-pre-wrap text-sm leading-7 text-slate-300">{service.description || <span className="text-slate-500">No description has been added.</span>}</p><ServiceMetadata service={service} /></CardContent>
          </Card>
          <Card>
            <CardHeader className="border-b border-border/70 px-5 py-4"><CardTitle className="text-[15px]">Repository</CardTitle></CardHeader>
            <CardContent className="p-5">{service.repository_url ? <a href={service.repository_url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-2 break-all text-sm text-sky-200 underline-offset-4 hover:underline"><span className="break-all">{service.repository_url}</span><ExternalLink className="size-3.5 shrink-0" /></a> : <p className="text-sm text-slate-500">No repository URL linked.</p>}<div className="mt-5 border-t border-border/70 pt-4 text-xs text-slate-500"><p>Created <time dateTime={service.created_at}>{new Date(service.created_at).toLocaleString()}</time></p><p className="mt-2">Last updated <time dateTime={service.updated_at}>{new Date(service.updated_at).toLocaleString()}</time></p></div></CardContent>
          </Card>
        </div>

        {!canManage && <p className="text-xs text-slate-500">Only workspace administrators can edit or change service status.</p>}
      </>}

      {service && <>
        <Dialog open={editOpen} onOpenChange={(open) => { if (!saving) { setEditOpen(open); if (!open) setEditError(null) } }}>
          <DialogContent className="top-[5vh] max-h-[90vh] max-w-2xl overflow-y-auto p-0">
            <div className="border-b border-border px-5 py-5 pr-12 sm:px-6"><div className="mb-2 flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-sky-400/10 text-sky-200"><Pencil className="size-4" /></span><Badge variant="muted">Service registry</Badge></div><DialogTitle className="text-xl text-slate-100">Edit service</DialogTitle><DialogDescription className="mt-1.5">Changes are saved to this workspace’s service record.</DialogDescription></div>
            <div className="p-5 sm:p-6"><ServiceForm service={service} busy={saving} error={editError} onSubmit={updateService} onCancel={() => setEditOpen(false)} /></div>
          </DialogContent>
        </Dialog>

        <Dialog open={archiveOpen} onOpenChange={(open) => { if (!statusBusy) setArchiveOpen(open) }}>
          <DialogContent className="max-w-md p-5 sm:p-6">
            <div className="grid size-10 place-items-center rounded-xl border border-amber-300/20 bg-amber-300/[0.07] text-amber-200"><Archive className="size-5" /></div>
            <DialogTitle className="mt-4 text-lg text-slate-100">Archive {service.name}?</DialogTitle>
            <DialogDescription className="mt-2 leading-6">The service will remain in the registry for reference. You can reactivate it later. This does not delete the service.</DialogDescription>
            {statusError && <p role="alert" className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] p-3 text-sm text-rose-200">{statusError}</p>}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="secondary" disabled={statusBusy} onClick={() => setArchiveOpen(false)}>Cancel</Button><Button variant="destructive" disabled={statusBusy} onClick={() => void changeStatus('archived')}>{statusBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Archive className="size-4" />} Archive service</Button></div>
          </DialogContent>
        </Dialog>
      </>}
    </div>
  )
}
