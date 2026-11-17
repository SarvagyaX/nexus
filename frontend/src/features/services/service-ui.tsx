import { AlertTriangle, CheckCircle2, CircleDashed, Server } from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent } from '../../components/ui/card'
import type { Service, ServiceStatus } from './types'

export function StatusBadge({ status }: { status: ServiceStatus }) {
  return <Badge variant={status === 'active' ? 'success' : 'muted'} className="capitalize">{status}</Badge>
}

export function ServiceSkeletons() {
  return (
    <div aria-label="Loading services" aria-live="polite" className="grid gap-3">
      {[0, 1, 2].map((item) => <div key={item} className="h-[78px] animate-pulse rounded-xl border border-border bg-card/70" />)}
    </div>
  )
}

export function ServiceError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="border-rose-400/20 bg-rose-400/[0.035]">
      <CardContent className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3"><span className="mt-0.5 text-rose-300"><AlertTriangle className="size-5" /></span><div><h2 className="font-medium text-slate-100">Could not load services</h2><p role="alert" className="mt-1 text-sm text-slate-400">{message}</p></div></div>
        <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>
      </CardContent>
    </Card>
  )
}

export function ServiceEmpty({ hasFilters, onClear }: { hasFilters: boolean; onClear?: () => void }) {
  return (
    <Card className="border-dashed bg-card/45">
      <CardContent className="flex min-h-64 flex-col items-center justify-center px-5 py-10 text-center">
        <span className="grid size-12 place-items-center rounded-xl border border-sky-400/15 bg-sky-400/[0.06] text-sky-200"><Server className="size-5" /></span>
        <h2 className="mt-4 text-base font-semibold text-slate-100">{hasFilters ? 'No services match these filters' : 'No services registered yet'}</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{hasFilters ? 'Try a different search or status filter to find a service.' : 'Add your first service to give your workspace a clear, shared service catalog.'}</p>
        {hasFilters && onClear && <Button variant="secondary" size="sm" className="mt-4" onClick={onClear}>Clear filters</Button>}
      </CardContent>
    </Card>
  )
}

export function StatTile({ label, value, detail, tone }: { label: string; value: number | null | undefined; detail: string; tone: 'blue' | 'green' | 'slate' }) {
  const color = tone === 'green' ? 'text-emerald-300 bg-emerald-400/10' : tone === 'blue' ? 'text-sky-300 bg-sky-400/10' : 'text-slate-300 bg-white/[0.045]'
  const Icon = tone === 'green' ? CheckCircle2 : tone === 'blue' ? Server : CircleDashed
  return (
    <Card className="transition-colors hover:border-white/[0.14]">
      <CardContent className="flex items-center justify-between gap-4 p-4 sm:p-5">
        <div><p className="text-xs font-medium text-slate-400">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight text-slate-100" aria-live="polite">{value === null ? <span className="inline-block h-7 w-10 animate-pulse rounded bg-white/[0.08] align-middle" aria-label="Loading" /> : value === undefined ? '—' : value.toLocaleString()}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>
        <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${color}`}><Icon className="size-[18px]" /></span>
      </CardContent>
    </Card>
  )
}

export function ServiceMetadata({ service }: { service: Service }) {
  const values = [
    ['Service key', service.service_key, true],
    ['Environment', service.environment, false],
    ['Owning team', service.owner_team, false],
    ['Updated', new Date(service.updated_at).toLocaleString(), false],
  ] as const
  return <dl className="grid gap-4 sm:grid-cols-2">{values.map(([label, value, mono]) => <div key={label} className="min-w-0"><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className={`mt-1.5 break-words text-sm text-slate-200 ${mono ? 'font-mono' : ''}`}>{value || '—'}</dd></div>)}</dl>
}
