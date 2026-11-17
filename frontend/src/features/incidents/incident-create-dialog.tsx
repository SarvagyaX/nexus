import { useEffect, useState, type FormEvent } from 'react'
import { LoaderCircle, Plus } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import type { Service } from '../services/types'
import { IncidentApiError } from './api'
import type { IncidentCreateInput, IncidentSeverity } from './types'

function localDateTimeNow() {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

export function IncidentCreateDialog({
  open, services, servicesLoading, servicesError, busy, error, onOpenChange, onSubmit,
}: {
  open: boolean
  services: Service[]
  servicesLoading: boolean
  servicesError: string | null
  busy: boolean
  error: IncidentApiError | null
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: IncidentCreateInput) => Promise<void>
}) {
  const [serviceId, setServiceId] = useState('')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [severity, setSeverity] = useState<IncidentSeverity>('SEV3')
  const [detectedAt, setDetectedAt] = useState(localDateTimeNow())
  const [startedAt, setStartedAt] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const activeServices = services.filter((service) => service.status === 'active')

  useEffect(() => {
    if (open) {
      setServiceId(''); setTitle(''); setSummary(''); setSeverity('SEV3')
      setDetectedAt(localDateTimeNow()); setStartedAt(''); setValidationError(null)
    }
  }, [open])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!serviceId) { setValidationError('Choose an active registered service.'); return }
    if (!title.trim()) { setValidationError('Enter an incident title.'); return }
    if (!detectedAt) { setValidationError('Choose when the incident was detected.'); return }
    if (startedAt && new Date(startedAt) < new Date(detectedAt)) {
      setValidationError('Started time must be the same as or later than detected time.')
      return
    }
    setValidationError(null)
    await onSubmit({
      service_id: serviceId, title: title.trim(), summary: summary.trim() || null, severity,
      detected_at: new Date(detectedAt).toISOString(),
      ...(startedAt ? { started_at: new Date(startedAt).toISOString() } : {}),
    })
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="top-[5vh] max-h-[90dvh] max-w-2xl translate-y-0 overflow-y-auto p-0 sm:top-[7vh]">
      <div className="border-b border-border/80 px-5 py-5 pr-14 sm:px-6"><div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-sky-300"><Plus className="size-3.5" /> Incident intake</div><DialogTitle className="text-xl">Create incident</DialogTitle><DialogDescription className="mt-1">Record the initial impact and service context. You can update ownership and lifecycle after creation.</DialogDescription></div>
      <form onSubmit={(event) => void submit(event)} className="space-y-5 p-5 sm:p-6">
        {(validationError || error) && <div role="alert" className="rounded-lg border border-rose-400/25 bg-rose-400/[0.07] px-3.5 py-3 text-sm text-rose-200">{validationError ?? error?.message}{error?.status === 401 ? <span> Sign in again to continue.</span> : null}</div>}
        {error?.details.map((item, index) => item.reason && <p key={`${item.field ?? 'field'}-${index}`} className="-mt-3 text-xs text-rose-300">{item.field ? `${item.field}: ` : ''}{item.reason}</p>)}
        <div className="grid gap-4 sm:grid-cols-2">
          <label htmlFor="incident-service" className="space-y-1.5 text-sm font-medium sm:col-span-2">Service <span aria-hidden="true" className="text-rose-300">*</span>
            <select id="incident-service" required value={serviceId} onChange={(event) => setServiceId(event.target.value)} disabled={servicesLoading || activeServices.length === 0} className="h-10 w-full rounded-lg border border-input bg-background/70 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/30"><option value="">{servicesLoading ? 'Loading services…' : activeServices.length ? 'Choose an active service' : 'No active services available'}</option>{activeServices.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.service_key}</option>)}</select>
            <span className="block text-xs font-normal text-muted-foreground">Archived services cannot receive new incidents.{servicesError ? ` ${servicesError}` : ''}</span>
          </label>
          <label htmlFor="incident-title" className="space-y-1.5 text-sm font-medium sm:col-span-2">Title <span aria-hidden="true" className="text-rose-300">*</span>
            <Input id="incident-title" autoFocus required maxLength={240} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Elevated checkout failures" />
          </label>
          <label htmlFor="incident-severity" className="space-y-1.5 text-sm font-medium">Severity
            <select id="incident-severity" value={severity} onChange={(event) => setSeverity(event.target.value as IncidentSeverity)} className="h-10 w-full rounded-lg border border-input bg-background/70 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/30"><option value="SEV1">SEV1 · Critical</option><option value="SEV2">SEV2 · High</option><option value="SEV3">SEV3 · Medium</option><option value="SEV4">SEV4 · Low</option></select>
          </label>
          <label htmlFor="incident-detected" className="space-y-1.5 text-sm font-medium">Detected at <span aria-hidden="true" className="text-rose-300">*</span>
            <Input id="incident-detected" type="datetime-local" required value={detectedAt} onChange={(event) => setDetectedAt(event.target.value)} />
          </label>
          <label htmlFor="incident-started" className="space-y-1.5 text-sm font-medium">Response started <span className="font-normal text-muted-foreground">(optional)</span>
            <Input id="incident-started" type="datetime-local" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} />
          </label>
          <label htmlFor="incident-summary" className="space-y-1.5 text-sm font-medium sm:col-span-2">Description <span className="font-normal text-muted-foreground">(optional)</span>
            <textarea id="incident-summary" maxLength={4000} rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Describe impact, symptoms, or known context" className="w-full resize-y rounded-lg border border-input bg-background/70 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/30" />
            <span className="block text-right text-[11px] font-normal text-slate-500">{summary.length}/4000</span>
          </label>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end"><Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={busy || servicesLoading || activeServices.length === 0 || !title.trim()}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}{busy ? 'Creating…' : 'Create incident'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>
}
