import { AlertTriangle, CircleDashed, RotateCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { cn } from '../../lib/utils'
import type { IncidentSeverity, IncidentStatus } from './types'

const severityStyles: Record<IncidentSeverity, { variant: 'danger' | 'warning' | 'violet' | 'muted'; label: string }> = {
  SEV1: { variant: 'danger', label: 'Critical' },
  SEV2: { variant: 'warning', label: 'High' },
  SEV3: { variant: 'violet', label: 'Medium' },
  SEV4: { variant: 'muted', label: 'Low' },
}

export function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
  const style = severityStyles[severity]
  return <Badge variant={style.variant} aria-label={`${style.label} severity ${severity}`}><span className="font-mono">{severity}</span><span className="hidden sm:inline">{style.label}</span></Badge>
}

const statusStyles: Record<IncidentStatus, { dot: string; text: string }> = {
  open: { dot: 'bg-sky-300', text: 'text-sky-100' },
  investigating: { dot: 'bg-rose-300', text: 'text-rose-100' },
  monitoring: { dot: 'bg-amber-300', text: 'text-amber-100' },
  resolved: { dot: 'bg-emerald-300', text: 'text-emerald-100' },
}

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  return <span className={cn('inline-flex items-center gap-2 whitespace-nowrap rounded-md border border-border/80 bg-white/[0.025] px-2 py-1 text-xs font-medium capitalize', statusStyles[status].text)}><span className={cn('size-1.5 rounded-full', statusStyles[status].dot)} />{status.replace('_', ' ')}</span>
}

export function formatTimestamp(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function ApiErrorPanel({ message, status, onRetry }: { message: string; status?: number; onRetry: () => void }) {
  const heading = status === 401 ? 'Your session has expired' : status === 403 ? 'Access restricted' : status === 404 ? 'Workspace or incident not found' : 'Could not load incidents'
  const body = status === 401 ? 'Sign in again to continue.' : status === 403 ? 'Your workspace role does not allow this action.' : status === 404 ? 'This resource may have been removed or is outside your workspace.' : message
  return <Card className="border-rose-400/20 bg-rose-400/[0.035] p-5 sm:p-6"><div className="flex gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-rose-400/10 text-rose-200"><AlertTriangle className="size-4" /></span><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold text-slate-100">{heading}</h2><p className="mt-1.5 text-sm leading-6 text-slate-400">{body}</p>{status === 401 ? <Link className="mt-3 inline-flex text-sm font-medium text-sky-300 hover:text-sky-200" to="/login">Sign in</Link> : status !== 403 && <Button variant="ghost" size="sm" className="mt-3 -ml-2 text-sky-300" onClick={onRetry}><RotateCw className="size-3.5" /> Retry</Button>}</div></div></Card>
}

export function IncidentSkeleton({ rows = 4 }: { rows?: number }) {
  return <div aria-label="Loading incidents" aria-busy="true" className="space-y-3">{Array.from({ length: rows }, (_, index) => <div key={index} className="h-[62px] animate-pulse rounded-lg border border-border/60 bg-white/[0.025]" />)}<span className="sr-only">Loading incident data</span></div>
}

export function LoadingMetric() {
  return <span className="inline-flex items-center gap-2 text-slate-500"><CircleDashed className="size-4 animate-spin" /><span className="sr-only">Loading</span></span>
}
