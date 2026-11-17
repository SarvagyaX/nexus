import { useEffect, useState, type FormEvent } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { ServiceApiError } from './api'
import type { Service, ServiceInput, ServicePatch } from './types'

type ServiceFormProps = {
  service?: Service
  busy: boolean
  error: ServiceApiError | null
  onSubmit: (payload: ServiceInput | ServicePatch) => Promise<void>
  onCancel: () => void
}

export function ServiceForm({ service, busy, error, onSubmit, onCancel }: ServiceFormProps) {
  const [name, setName] = useState(service?.name ?? '')
  const [serviceKey, setServiceKey] = useState(service?.service_key ?? '')
  const [description, setDescription] = useState(service?.description ?? '')
  const [ownerTeam, setOwnerTeam] = useState(service?.owner_team ?? '')
  const [environment, setEnvironment] = useState(service?.environment ?? '')
  const [repositoryUrl, setRepositoryUrl] = useState(service?.repository_url ?? '')
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    setName(service?.name ?? '')
    setServiceKey(service?.service_key ?? '')
    setDescription(service?.description ?? '')
    setOwnerTeam(service?.owner_team ?? '')
    setEnvironment(service?.environment ?? '')
    setRepositoryUrl(service?.repository_url ?? '')
    setLocalError(null)
  }, [service])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedKey = serviceKey.trim().toLowerCase()
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(normalizedKey)) {
      setLocalError('Use lowercase letters, numbers, dots, underscores, or hyphens in the service key.')
      return
    }
    setLocalError(null)
    const payload = {
      name: name.trim(),
      service_key: normalizedKey,
      description: description.trim() || null,
      owner_team: ownerTeam.trim() || null,
      environment: environment.trim() || null,
      repository_url: repositoryUrl.trim() || null,
    }
    await onSubmit(payload)
  }

  const errorText = localError ?? error?.message

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      {errorText && <div role="alert" className="rounded-lg border border-rose-400/25 bg-rose-400/[0.07] px-3.5 py-3 text-sm text-rose-200">{errorText}</div>}
      {error?.details.map((item, index) => item.reason && (
        <p key={`${item.field ?? 'field'}-${index}`} className="-mt-3 text-xs text-rose-300">{item.field ? `${item.field}: ` : ''}{item.reason}</p>
      ))}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium sm:col-span-2" htmlFor="service-name">
          Service name <span className="text-rose-300" aria-hidden="true">*</span>
          <Input id="service-name" autoFocus maxLength={160} required value={name} onChange={(event) => setName(event.target.value)} placeholder="Payments API" />
        </label>
        <label className="space-y-1.5 text-sm font-medium sm:col-span-2" htmlFor="service-key">
          Service key <span className="text-rose-300" aria-hidden="true">*</span>
          <Input id="service-key" maxLength={100} required pattern="[A-Za-z0-9]+([._-][A-Za-z0-9]+)*" value={serviceKey} onChange={(event) => setServiceKey(event.target.value)} placeholder="payments-api" aria-describedby="service-key-help" />
          <span id="service-key-help" className="block text-xs font-normal text-muted-foreground">Stable identifier used to reference this service.</span>
        </label>
        <label className="space-y-1.5 text-sm font-medium" htmlFor="service-team">
          Owning team
          <Input id="service-team" maxLength={160} value={ownerTeam} onChange={(event) => setOwnerTeam(event.target.value)} placeholder="Platform" />
        </label>
        <label className="space-y-1.5 text-sm font-medium" htmlFor="service-environment">
          Environment
          <Input id="service-environment" maxLength={80} value={environment} onChange={(event) => setEnvironment(event.target.value)} placeholder="Production" />
        </label>
        <label className="space-y-1.5 text-sm font-medium sm:col-span-2" htmlFor="service-repository">
          Repository URL
          <Input id="service-repository" type="url" maxLength={2048} value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} placeholder="https://github.com/acme/payments" />
        </label>
        <label className="space-y-1.5 text-sm font-medium sm:col-span-2" htmlFor="service-description">
          Description
          <textarea id="service-description" maxLength={2000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this service is responsible for" className="w-full resize-y rounded-lg border border-input bg-background/70 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/30" />
        </label>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" disabled={busy || !name.trim() || !serviceKey.trim()}>
          {busy && <LoaderCircle className="size-4 animate-spin" />}{service ? 'Save changes' : 'Create service'}
        </Button>
      </div>
    </form>
  )
}
