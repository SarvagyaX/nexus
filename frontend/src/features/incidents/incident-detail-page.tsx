import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Check, Clock3, LoaderCircle, MessageSquareText, Save, Send, ShieldCheck, Sparkles, UserRound } from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { useAuth } from '../auth/auth-context'
import { IncidentApiError, incidentsApi } from './api'
import { investigationsApi } from '../investigations/api'
import { ApiErrorPanel, IncidentSkeleton, IncidentStatusBadge, SeverityBadge, formatTimestamp } from './incident-ui'
import type { Incident, IncidentEvent, IncidentSeverity, IncidentStatus } from './types'

const transitions: Record<IncidentStatus, IncidentStatus[]> = {
  open: ['investigating'],
  investigating: ['monitoring'],
  monitoring: ['resolved', 'open', 'investigating'],
  resolved: [],
}

function message(error: unknown) { return error instanceof Error ? error.message : 'The request could not be completed.' }
function statusCode(error: unknown) { return error instanceof IncidentApiError ? error.status : undefined }

function EventDescription({ event }: { event: IncidentEvent }) {
  const from = typeof event.payload.from === 'string' ? event.payload.from : null
  const to = typeof event.payload.to === 'string' ? event.payload.to : null
  const field = typeof event.payload.field === 'string' ? event.payload.field : null
  const changedTo = typeof event.payload.to === 'string' ? event.payload.to : null
  if (event.body) return <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{event.body}</p>
  if (event.event_type === 'incident.created') return <p className="text-sm leading-6 text-slate-400">Incident record created.</p>
  if (event.event_type === 'incident.status_changed') return <p className="text-sm leading-6 text-slate-400">Status changed{from && to ? <> from <span className="font-medium capitalize text-slate-200">{from}</span> to <span className="font-medium capitalize text-slate-200">{to}</span></> : ''}.</p>
  if (event.event_type === 'incident.severity_changed') return <p className="text-sm leading-6 text-slate-400">Severity updated{changedTo ? <> to <span className="font-mono text-slate-200">{changedTo}</span></> : ''}.</p>
  if (event.event_type === 'incident.assignment_changed') return <p className="text-sm leading-6 text-slate-400">Assignee {changedTo ? 'changed' : 'removed'}.</p>
  if (event.event_type === 'incident.details_changed') return <p className="text-sm leading-6 text-slate-400">Incident {field === 'title' ? 'title' : 'description'} updated.</p>
  return <p className="text-sm leading-6 text-slate-400">{event.event_type.replaceAll('.', ' ').replaceAll('_', ' ')}.</p>
}

export function IncidentDetailPage() {
  const { incidentId = '' } = useParams()
  const navigate = useNavigate()
  const { activeWorkspaceId, workspaces, user, csrfToken } = useAuth()
  const role = workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.role
  const canWrite = role === 'admin' || role === 'commander' || role === 'responder'
  const [incident, setIncident] = useState<Incident | null>(null)
  const [events, setEvents] = useState<IncidentEvent[]>([])
  const [eventCursor, setEventCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [eventError, setEventError] = useState<unknown>(null)
  const [eventsLoading, setEventsLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [severity, setSeverity] = useState<IncidentSeverity>('SEV3')
  const [assignee, setAssignee] = useState('')
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string | null>(null)
  const [resolutionOpen, setResolutionOpen] = useState(false)
  const [resolutionSummary, setResolutionSummary] = useState('')
  const [resolutionReason, setResolutionReason] = useState('')

  useEffect(() => {
    if (!activeWorkspaceId || !incidentId) return
    const controller = new AbortController()
    setLoading(true); setError(null); setIncident(null)
    void incidentsApi.get(activeWorkspaceId, incidentId, controller.signal).then((value) => {
      setIncident(value); setTitle(value.title); setSummary(value.summary ?? '')
      setSeverity(value.severity); setAssignee(value.assignee_user_id ?? '')
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [activeWorkspaceId, incidentId, refresh])

  useEffect(() => {
    if (!activeWorkspaceId || !incidentId) return
    const controller = new AbortController()
    setEventsLoading(true); setEventError(null); setEvents([]); setEventCursor(null)
    void incidentsApi.events(activeWorkspaceId, incidentId, null, controller.signal).then((page) => {
      setEvents(page.items); setEventCursor(page.page.next_cursor)
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setEventError(cause) })
      .finally(() => { if (!controller.signal.aborted) setEventsLoading(false) })
    return () => controller.abort()
  }, [activeWorkspaceId, incidentId, refresh])

  async function loadMoreEvents() {
    if (!activeWorkspaceId || !eventCursor) return
    setEventsLoading(true); setEventError(null)
    try {
      const page = await incidentsApi.events(activeWorkspaceId, incidentId, eventCursor)
      setEvents((current) => [...current, ...page.items]); setEventCursor(page.page.next_cursor)
    } catch (cause) { setEventError(cause) } finally { setEventsLoading(false) }
  }

  async function saveChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!incident || !activeWorkspaceId || !csrfToken) return
    if (!title.trim()) { setMutationError('Incident title is required.'); return }
    setBusy(true); setMutationError(null)
    try {
      const payload = {
        title: title.trim(), summary: summary.trim() || null, severity,
        assignee_user_id: assignee || null,
      }
      const updated = await incidentsApi.update(activeWorkspaceId, incident.id, payload, csrfToken)
      setIncident(updated); setRefresh((value) => value + 1)
    } catch (cause) { setMutationError(message(cause)) } finally { setBusy(false) }
  }

  async function changeStatus(target: IncidentStatus, reason?: string, resolution?: string) {
    if (!incident || !activeWorkspaceId || !csrfToken) return
    setBusy(true); setMutationError(null)
    try {
      const updated = await incidentsApi.transition(activeWorkspaceId, incident.id, {
        to_status: target, ...(reason?.trim() ? { reason: reason.trim() } : {}),
        ...(target === 'resolved' ? { resolution_summary: resolution?.trim() ?? '' } : {}),
      }, csrfToken)
      setIncident(updated); setRefresh((value) => value + 1); setResolutionOpen(false); setResolutionSummary(''); setResolutionReason('')
    } catch (cause) { setMutationError(message(cause)) } finally { setBusy(false) }
  }

  async function launchAiInvestigation() {
    if (!activeWorkspaceId || !incident || !csrfToken) return
    setBusy(true)
    setMutationError(null)
    try {
      const inv = await investigationsApi.start(activeWorkspaceId, incident.id, csrfToken)
      navigate(`/investigations/${inv.id}`)
    } catch (cause) {
      setMutationError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeWorkspaceId || !incident || !csrfToken) return
    if (!note.trim()) { setNoteError('Enter a note before adding it to the timeline.'); return }
    setBusy(true); setNoteError(null)
    try {
      await incidentsApi.addNote(activeWorkspaceId, incident.id, note.trim(), csrfToken)
      setNote(''); setRefresh((value) => value + 1)
    } catch (cause) { setNoteError(message(cause)) } finally { setBusy(false) }
  }

  if (!activeWorkspaceId) return <ApiErrorPanel message="No active workspace is available." onRetry={() => navigate('/incidents')} />
  if (loading) return <div className="mx-auto max-w-[1440px] space-y-5"><IncidentSkeleton rows={6} /></div>
  if (error || !incident) return <div className="mx-auto max-w-3xl"><ApiErrorPanel message={message(error)} status={statusCode(error)} onRetry={() => setRefresh((value) => value + 1)} /></div>

  const assigneeChoices = new Map<string, string>()
  if (user) assigneeChoices.set(user.id, `${user.display_name} (you)`)
  if (incident.assignee) assigneeChoices.set(incident.assignee.id, incident.assignee.display_name)

  return <div className="mx-auto max-w-[1440px] space-y-6 sm:space-y-7">
    <Link to="/incidents" className="inline-flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-sky-200"><ArrowLeft className="size-4" />Back to incidents</Link>
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between"><div className="min-w-0"><div className="mb-2 flex flex-wrap items-center gap-2"><span className="font-mono text-xs tracking-wide text-slate-400">{incident.reference}</span><span className="text-slate-700">/</span><span className="truncate text-xs text-slate-500">{incident.service?.name ?? 'Unknown service'}</span><Badge variant="violet" className="text-[9px] uppercase tracking-[0.08em]">{incident.severity_source === 'human' ? 'Human severity' : incident.severity_source === 'demo' ? 'Demo severity' : 'AI proposed severity'}</Badge></div><h1 className="text-[26px] font-semibold tracking-[-0.04em] text-slate-100 sm:text-[34px]">{incident.title}</h1><p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-slate-400">{incident.summary || 'No description has been added.'}</p><div className="mt-4 flex flex-wrap items-center gap-2"><SeverityBadge severity={incident.severity} /><IncidentStatusBadge status={incident.status} /></div></div>
      <div className="flex flex-wrap items-center gap-2 xl:justify-end">
        {canWrite && <Button variant="outline" className="border-sky-400/30 text-sky-300 hover:bg-sky-400/10" disabled={busy} onClick={() => void launchAiInvestigation()}><Sparkles className="size-4" /> Investigate with AI</Button>}
        {canWrite && incident.status !== 'resolved' && transitions[incident.status].map((target) => target === 'resolved' ? <Button key={target} variant="outline" className="border-emerald-400/20 text-emerald-200 hover:bg-emerald-400/10" disabled={busy} onClick={() => setResolutionOpen(true)}><ShieldCheck className="size-4" /> Resolve</Button> : <Button key={target} variant={target === 'open' ? 'outline' : 'secondary'} disabled={busy} onClick={() => void changeStatus(target)}>{target === 'investigating' ? 'Start investigation' : target === 'monitoring' ? 'Move to monitoring' : 'Reopen as open'}</Button>)}
      </div>
    </div>

    {mutationError && <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-400/25 bg-rose-400/[0.06] px-4 py-3 text-sm text-rose-200"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{mutationError}</div>}

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Card className="overflow-hidden"><CardHeader className="flex-row items-center justify-between border-b border-border/70 px-5 py-4"><div><CardTitle className="text-[15px]">Incident timeline</CardTitle><p className="mt-1 text-xs text-muted-foreground">An append-only history of response activity.</p></div><Clock3 className="size-4 text-slate-500" /></CardHeader>
          {Boolean(eventError) && <div className="p-4"><ApiErrorPanel message={message(eventError)} status={statusCode(eventError)} onRetry={() => setRefresh((value) => value + 1)} /></div>}
          {eventsLoading && events.length === 0 ? <div className="p-4"><IncidentSkeleton rows={3} /></div> : !events.length ? <div className="px-5 py-9 text-center text-sm text-slate-500">No timeline events are available.</div> : <ol className="divide-y divide-border/60">{events.map((item) => <li key={item.id} className="flex gap-3.5 px-4 py-4 sm:px-5"><span className="relative mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border border-sky-300/15 bg-sky-300/[0.07] text-sky-200"><MessageSquareText className="size-3.5" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"><p className="text-xs font-medium text-slate-200">{item.actor_user_id === user?.id ? 'You' : item.actor_user_id ? `Workspace member Â· ${item.actor_user_id.slice(0, 8)}` : 'System'}</p><time dateTime={item.created_at} className="text-[10px] text-slate-500">{formatTimestamp(item.created_at)}</time></div><p className="mt-1 text-[11px] capitalize text-slate-500">{item.event_type.replaceAll('.', ' ').replaceAll('_', ' ')}</p><div className="mt-1.5"><EventDescription event={item} /></div></div></li>)}</ol>}
          {eventCursor && <div className="border-t border-border/70 p-3 text-center"><Button variant="ghost" size="sm" disabled={eventsLoading} onClick={() => void loadMoreEvents()}>{eventsLoading && <LoaderCircle className="size-3.5 animate-spin" />}Load more events</Button></div>}
        </Card>
        {canWrite && <Card><CardHeader className="pb-3"><CardTitle className="text-[15px]">Add timeline note</CardTitle><p className="text-xs text-muted-foreground">Notes become part of the permanent incident history.</p></CardHeader><CardContent><form onSubmit={(event) => void addNote(event)} className="space-y-3"><label htmlFor="incident-note" className="sr-only">Incident timeline note</label><textarea id="incident-note" rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Share a response update or handoff noteâ€¦" className="w-full resize-y rounded-lg border border-input bg-background/70 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/30" />{noteError && <p role="alert" className="text-xs text-rose-300">{noteError}</p>}<div className="flex items-center justify-between gap-3"><p className="text-[11px] text-slate-500">{note.length}/4000 Â· Cannot be edited or removed</p><Button size="sm" type="submit" disabled={busy || !note.trim()}>{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}Add note</Button></div></form></CardContent></Card>}
      </div>

      <aside className="space-y-5">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-[15px]">Incident details</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid gap-4">
              <div><dt className="text-xs font-medium text-slate-500">Service</dt><dd className="mt-1.5 text-sm text-slate-200">{incident.service?.name ?? 'Unknown service'}<span className="mt-0.5 block font-mono text-[11px] text-slate-500">{incident.service?.service_key ?? incident.service_id}</span></dd></div>
              <div><dt className="text-xs font-medium text-slate-500">Assignee</dt><dd className="mt-1.5 flex items-center gap-2 text-sm text-slate-200"><UserRound className="size-4 text-slate-500" />{incident.assignee?.display_name ?? 'Unassigned'}</dd>{incident.assignee && <p className="ml-6 mt-0.5 text-xs text-slate-500">{incident.assignee.email}</p>}</div>
              <div><dt className="text-xs font-medium text-slate-500">Detected</dt><dd className="mt-1.5 text-sm text-slate-300">{formatTimestamp(incident.detected_at)}</dd></div>
              {incident.started_at && <div><dt className="text-xs font-medium text-slate-500">Response started</dt><dd className="mt-1.5 text-sm text-slate-300">{formatTimestamp(incident.started_at)}</dd></div>}
              <div><dt className="text-xs font-medium text-slate-500">Created</dt><dd className="mt-1.5 text-sm text-slate-300">{formatTimestamp(incident.created_at)}</dd></div>
              <div><dt className="text-xs font-medium text-slate-500">Last updated</dt><dd className="mt-1.5 text-sm text-slate-300">{formatTimestamp(incident.updated_at)}</dd></div>
              {incident.resolved_at && <div><dt className="text-xs font-medium text-slate-500">Resolved</dt><dd className="mt-1.5 text-sm text-slate-300">{formatTimestamp(incident.resolved_at)}</dd></div>}
              {incident.status === 'resolved' && <div className="rounded-lg border border-emerald-400/15 bg-emerald-400/[0.04] p-3"><dt className="text-xs font-medium text-emerald-200">Resolution summary</dt><dd className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-300">{incident.resolution_summary || 'No summary provided.'}</dd></div>}
            </dl>
          </CardContent>
        </Card>
        {canWrite && <Card><CardHeader className="pb-3"><CardTitle className="text-[15px]">Update incident</CardTitle><p className="text-xs text-muted-foreground">Changes are recorded in the incident timeline.</p></CardHeader><CardContent><form onSubmit={(event) => void saveChanges(event)} className="space-y-4">
          <label htmlFor="edit-incident-title" className="block space-y-1.5 text-xs font-medium text-slate-300">Title<Input id="edit-incident-title" maxLength={240} required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label htmlFor="edit-incident-summary" className="block space-y-1.5 text-xs font-medium text-slate-300">Description<textarea id="edit-incident-summary" rows={3} maxLength={4000} value={summary} onChange={(event) => setSummary(event.target.value)} className="w-full resize-y rounded-lg border border-input bg-background/70 px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/30" /></label>
          <label htmlFor="edit-incident-severity" className="block space-y-1.5 text-xs font-medium text-slate-300">Severity<select id="edit-incident-severity" value={severity} onChange={(event) => setSeverity(event.target.value as IncidentSeverity)} className="h-10 w-full rounded-lg border border-input bg-background/70 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/30"><option value="SEV1">SEV1 Â· Critical</option><option value="SEV2">SEV2 Â· High</option><option value="SEV3">SEV3 Â· Medium</option><option value="SEV4">SEV4 Â· Low</option></select></label>
          <label htmlFor="edit-incident-assignee" className="block space-y-1.5 text-xs font-medium text-slate-300">Assignee<select id="edit-incident-assignee" value={assignee} onChange={(event) => setAssignee(event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background/70 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/30"><option value="">Unassigned</option>{[...assigneeChoices.entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><span className="block text-[11px] font-normal leading-5 text-slate-500">The workspace member directory is not available yet. You can assign yourself or keep the current assignee.</span></label>
          <Button type="submit" className="w-full" disabled={busy || !title.trim()}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}Save changes</Button>
        </form></CardContent></Card>}
        <Card className="border-sky-300/10 bg-sky-300/[0.025]"><CardContent className="flex gap-3 p-4"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-sky-200" /><p className="text-xs leading-5 text-slate-400">Status changes and notes are recorded for audit. A resolved incident is terminal; recurrence should be tracked as a new incident.</p></CardContent></Card>
      </aside>
    </div>

    <Dialog open={resolutionOpen} onOpenChange={setResolutionOpen}><DialogContent className="max-w-lg p-5 sm:p-6"><DialogTitle className="text-lg">Resolve {incident.reference}</DialogTitle><DialogDescription className="mt-1">Resolution is terminal for this incident record. Confirm the outcome and add a summary for the timeline.</DialogDescription><form className="mt-5 space-y-4" onSubmit={(event) => { event.preventDefault(); if (!resolutionSummary.trim()) return; void changeStatus('resolved', resolutionReason, resolutionSummary) }}><label htmlFor="resolution-summary" className="block space-y-1.5 text-sm font-medium">Resolution summary <span className="text-rose-300" aria-hidden="true">*</span><textarea id="resolution-summary" required maxLength={4000} rows={4} value={resolutionSummary} onChange={(event) => setResolutionSummary(event.target.value)} placeholder="What changed and how was impact restored?" className="w-full resize-y rounded-lg border border-input bg-background/70 px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/30" /></label><label htmlFor="resolution-reason" className="block space-y-1.5 text-sm font-medium">Timeline reason <span className="font-normal text-muted-foreground">(optional)</span><Input id="resolution-reason" maxLength={4000} value={resolutionReason} onChange={(event) => setResolutionReason(event.target.value)} placeholder="Short status update" /></label>{mutationError && <p role="alert" className="text-sm text-rose-300">{mutationError}</p>}<div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end"><Button variant="secondary" disabled={busy} onClick={() => setResolutionOpen(false)}>Cancel</Button><Button type="submit" disabled={busy || !resolutionSummary.trim()}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}Confirm resolution</Button></div></form></DialogContent></Dialog>
  </div>
}
