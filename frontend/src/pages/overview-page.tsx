import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Clock3,
  Cpu, ExternalLink, Gauge, MoreHorizontal, Server,
  ShieldCheck, Siren,
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { Badge } from '../components/ui/badge'
import { buttonVariants } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { cn } from '../lib/utils'
import { useAuth } from '../features/auth/auth-context'
import { servicesApi } from '../features/services/api'
import { incidentsApi } from '../features/incidents/api'
import type { Service } from '../features/services/types'
import type { Incident } from '../features/incidents/types'
import { demoActivity, demoIncidents, demoServices, requestTrend } from '../data/demo-data'

const severityVariant: Record<string, 'danger' | 'warning' | 'violet' | 'muted'> = {
  SEV1: 'danger',
  SEV2: 'warning',
  SEV3: 'violet',
  SEV4: 'muted',
}

const healthVariant: Record<string, 'success' | 'warning' | 'muted'> = {
  operational: 'success',
  degraded: 'warning',
  archived: 'muted',
  Operational: 'success',
  Degraded: 'warning',
  Unknown: 'muted',
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  trend,
  tone,
}: {
  label: string
  value: string
  detail: string
  icon: typeof Activity
  trend?: { value: string; positive: boolean }
  tone: 'blue' | 'rose' | 'cyan' | 'violet'
}) {
  const iconTone = {
    blue: 'bg-blue-400/10 text-blue-300',
    rose: 'bg-rose-400/10 text-rose-300',
    cyan: 'bg-cyan-400/10 text-cyan-300',
    violet: 'bg-violet-400/10 text-violet-300',
  }[tone]
  return (
    <Card className="min-w-0 transition-colors hover:border-white/[0.14]">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-400 sm:text-[13px]">{label}</p>
            <p className="mt-3 text-[26px] font-semibold leading-none tracking-[-0.04em] text-slate-100 sm:text-[30px]">{value}</p>
          </div>
          <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', iconTone)}><Icon className="size-[17px]" strokeWidth={1.8} /></span>
        </div>
        <div className="mt-4 flex min-h-5 items-center justify-between gap-2">
          <span className="truncate text-[11px] text-slate-500">{detail}</span>
          {trend && <span className={cn('flex shrink-0 items-center gap-0.5 text-[11px] font-medium', trend.positive ? 'text-emerald-300' : 'text-rose-300')}>
            {trend.positive ? <ArrowDownRight className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}{trend.value}
          </span>}
        </div>
      </CardContent>
    </Card>
  )
}

function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey?: string; value?: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  const requests = payload.find((entry) => entry.dataKey === 'requests')?.value ?? 0
  const errors = payload.find((entry) => entry.dataKey === 'errors')?.value ?? 0
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2.5 shadow-xl">
      <p className="mb-1.5 text-xs font-medium text-slate-300">{label} · telemetry</p>
      <p className="text-xs text-slate-400"><span className="mr-2 inline-block size-2 rounded-full bg-sky-400" />{Number(requests).toLocaleString()} requests</p>
      <p className="mt-1 text-xs text-slate-400"><span className="mr-2 inline-block size-2 rounded-full bg-violet-400" />{Number(errors).toLocaleString()} errors</p>
    </div>
  )
}

function IncidentTable({ liveIncidents }: { liveIncidents: Incident[] }) {
  const displayItems = liveIncidents.length > 0 ? liveIncidents.slice(0, 5) : demoIncidents
  const isLive = liveIncidents.length > 0

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-3 px-5 pb-4 pt-5 sm:px-6">
        <div>
          <CardTitle className="text-[15px]">Recent incidents</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {isLive ? 'Live operational incidents from active workspace' : 'Latest activity across the workspace'}
          </p>
        </div>
        <Link to="/incidents" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'shrink-0 px-2 text-xs text-sky-300 hover:text-sky-200')}>
          All incidents <ArrowRight className="size-3.5" />
        </Link>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[660px] border-collapse text-left">
          <thead>
            <tr className="border-y border-border/80 bg-white/[0.018] text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              <th scope="col" className="px-5 py-3 sm:px-6">Incident</th>
              <th scope="col" className="px-4 py-3">Service</th>
              <th scope="col" className="px-4 py-3">Severity</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/65">
            {displayItems.map((incident: any) => {
              const incId = incident.id
              const linkTo = isLive ? `/incidents/${incId}` : '/incidents'
              const serviceName = incident.service?.name ?? incident.service ?? 'General'
              const severity = incident.severity ?? 'SEV2'
              const status = incident.status ?? 'Investigating'
              const updated = incident.updated_at
                ? new Date(incident.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : incident.updated ?? 'Just now'

              return (
                <tr key={incId} className="group transition-colors hover:bg-white/[0.025]">
                  <td className="px-5 py-3.5 sm:px-6">
                    <Link to={linkTo} className="block min-w-0">
                      <span className="block truncate text-[13px] font-medium text-slate-200 group-hover:text-sky-200">
                        {incident.title}
                      </span>
                      <span className="mt-1 block font-mono text-[10px] text-slate-500">
                        {incident.reference ?? incId}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="font-mono text-[11px] text-slate-400">{serviceName}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <Badge variant={severityVariant[severity] ?? 'warning'}>{severity}</Badge>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="flex items-center gap-2 whitespace-nowrap text-xs text-slate-400 capitalize">
                      <span
                        className={cn(
                          'size-1.5 rounded-full',
                          status.toLowerCase() === 'investigating' || status.toLowerCase() === 'open'
                            ? 'bg-rose-400'
                            : status.toLowerCase() === 'monitoring'
                            ? 'bg-amber-300'
                            : 'bg-emerald-400'
                        )}
                      />
                      {status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-xs text-slate-500">{updated}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-border/70 px-5 py-3 text-[11px] text-slate-500 sm:px-6">
        <span>{isLive ? `Showing ${displayItems.length} active incidents` : 'Showing simulated incident series'}</span>
        <Link to="/incidents" className="inline-flex items-center gap-1.5 text-slate-400 hover:text-slate-200">
          Open incident command center <ExternalLink className="size-3" />
        </Link>
      </div>
    </Card>
  )
}

function ServiceHealthCard({ liveServices }: { liveServices: Service[] }) {
  const displayServices = liveServices.length > 0 ? liveServices.slice(0, 5) : demoServices
  const isLive = liveServices.length > 0

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between px-5 pb-3 pt-5">
        <div>
          <CardTitle className="text-[15px]">Service health</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {isLive ? 'Monitored registry services' : 'Status from telemetry pipeline'}
          </p>
        </div>
        <Link to="/services" className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })} aria-label="View services">
          <MoreHorizontal className="size-[18px]" />
        </Link>
      </CardHeader>
      <CardContent className="px-5 pb-2">
        <div className="divide-y divide-border/65">
          {displayServices.map((service: any) => {
            const name = service.name
            const status = service.status ?? service.health ?? 'operational'
            const desc = service.description ?? (service.environment ? `Env: ${service.environment}` : 'Operational service')
            const isOperational = status === 'operational' || status === 'Operational'

            return (
              <div key={service.id ?? name} className="flex items-center gap-3 py-3.5 first:pt-2">
                <span
                  className={cn(
                    'grid size-8 shrink-0 place-items-center rounded-lg border',
                    isOperational
                      ? 'border-emerald-400/10 bg-emerald-400/[0.06] text-emerald-300'
                      : 'border-amber-400/10 bg-amber-400/[0.06] text-amber-200'
                  )}
                >
                  <Server className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-xs font-medium text-slate-200">{name}</span>
                    <Badge variant={healthVariant[status] ?? 'muted'} className="hidden px-1.5 text-[10px] capitalize sm:inline-flex">
                      {status}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-[10px] text-slate-500">{desc}</p>
                </div>
                <div className="hidden text-right sm:block">
                  <p className="font-mono text-xs text-slate-300">{service.latency ?? '14ms'}</p>
                  <p className="mt-1 text-[10px] text-slate-500">{service.errorRate ?? '0.01%'} errors</p>
                </div>
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full sm:hidden',
                    isOperational ? 'bg-emerald-400' : 'bg-amber-300'
                  )}
                  aria-label={status}
                />
              </div>
            )
          })}
        </div>
      </CardContent>
      <div className="border-t border-border/70 px-5 py-3">
        <Link to="/services" className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-300 hover:text-sky-200">
          View service registry <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </Card>
  )
}

function ActivityCard() {
  const avatarTone: Record<string, string> = {
    blue: 'bg-sky-400/10 text-sky-200',
    violet: 'bg-violet-400/10 text-violet-200',
    green: 'bg-emerald-400/10 text-emerald-200',
    slate: 'bg-slate-400/10 text-slate-300',
  }
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between px-5 pb-3 pt-5">
        <div>
          <CardTitle className="text-[15px]">Recent activity</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Workspace operational timeline</p>
        </div>
        <Activity className="size-4 text-slate-500" />
      </CardHeader>
      <CardContent className="px-5 pb-4">
        <ol className="space-y-4">
          {demoActivity.map((entry, index) => (
            <li key={`${entry.actor}-${entry.time}`} className="relative flex gap-3">
              {index < demoActivity.length - 1 && (
                <span aria-hidden="true" className="absolute bottom-[-17px] left-[15px] top-8 w-px bg-border/70" />
              )}
              <span className={cn('z-10 grid size-8 shrink-0 place-items-center rounded-full text-[10px] font-semibold', avatarTone[entry.tone])}>
                {entry.initials}
              </span>
              <p className="min-w-0 flex-1 pt-0.5 text-xs leading-[1.65] text-slate-400">
                <span className="font-medium text-slate-200">{entry.actor}</span> {entry.action}{' '}
                <Link to="/incidents" className="font-medium text-sky-300 hover:text-sky-200">
                  {entry.target}
                </Link>
                <span className="mt-1 block text-[10px] text-slate-600">{entry.time}</span>
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
      <div className="border-t border-border/70 px-5 py-3">
        <Link to="/incidents" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-200">
          View incident timeline <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </Card>
  )
}

export function OverviewPage() {
  const { activeWorkspaceId, workspaces } = useAuth()
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)

  const [liveServices, setLiveServices] = useState<Service[]>([])
  const [liveIncidents, setLiveIncidents] = useState<Incident[]>([])

  useEffect(() => {
    if (!activeWorkspaceId) return
    let active = true

    Promise.allSettled([
      servicesApi.list(activeWorkspaceId, { limit: 10 }),
      incidentsApi.list(activeWorkspaceId, { limit: 10 }),
    ]).then(([sRes, iRes]) => {
      if (!active) return
      if (sRes.status === 'fulfilled') {
        setLiveServices(sRes.value.items)
      }
      if (iRes.status === 'fulfilled') {
        setLiveIncidents(iRes.value.items)
      }
    })

    return () => {
      active = false
    }
  }, [activeWorkspaceId])

  const chartData = useMemo(() => {
    return requestTrend.map((point) => ({
      ...point,
      errorRate: Number(((point.errors / point.requests) * 100).toFixed(2)),
    }))
  }, [])

  const operationalServicesCount = liveServices.filter((s) => s.status === 'active').length
  const totalServices = liveServices.length > 0 ? liveServices.length : 5
  const operationalDisplay = liveServices.length > 0 ? `${operationalServicesCount} / ${totalServices}` : '3 / 5'

  const activeIncidentsCount = liveIncidents.filter((i) => i.status !== 'resolved').length
  const incidentsDisplay = liveIncidents.length > 0 ? `${activeIncidentsCount}` : '4'

  return (
    <div className="space-y-6 sm:space-y-7">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-400">Operations Command Center</p>
            <Badge variant="default" className="border-sky-400/20 bg-sky-400/10 text-sky-300 text-[9px] uppercase tracking-[0.08em]">
              Real-Time
            </Badge>
          </div>
          <h1 className="text-[26px] font-semibold tracking-[-0.04em] text-slate-100 sm:text-[32px]">
            {activeWorkspace?.name ?? 'Your systems at a glance'}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
            Real-time telemetry, service dependency health, incident command status, and agentic operational workflows.
          </p>
        </div>
        <Badge variant="muted" className="w-fit gap-2 px-2.5 py-1.5 text-xs font-medium text-slate-300">
          <Clock3 className="size-3.5 text-slate-500" /> Rolling Window · 24h
        </Badge>
      </section>

      {/* Workspace Status Banner */}
      <section
        aria-label="Workspace operational notice"
        className="flex items-start gap-3 rounded-xl border border-sky-400/20 bg-sky-400/[0.04] p-4 sm:items-center"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sky-400/10 text-sky-300">
          <ShieldCheck className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-slate-200">
            Connected to Workspace: {activeWorkspace?.name ?? 'NEXUS'}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            Platform services, alert bus, on-call schedules, and agentic AI investigation workflows are active and synchronized.
          </p>
        </div>
        <Badge variant="success" className="hidden shrink-0 border-emerald-400/20 bg-emerald-400/10 text-[10px] text-emerald-300 sm:inline-flex">
          <span className="mr-1.5 size-1.5 rounded-full bg-emerald-400" />
          Systems Operational
        </Badge>
      </section>

      {/* KPI Metrics */}
      <section aria-label="Operational metrics" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 sm:gap-4">
        <MetricCard
          label="Operational Services"
          value={operationalDisplay}
          detail={liveServices.length > 0 ? `${totalServices - operationalServicesCount} degraded/standby` : '1 degraded · 1 unknown'}
          icon={Server}
          tone="blue"
          trend={{ value: 'Healthy', positive: true }}
        />
        <MetricCard
          label="Active Incidents"
          value={incidentsDisplay}
          detail={liveIncidents.length > 0 ? `Across ${liveServices.length} registered services` : 'Across 3 services'}
          icon={Siren}
          tone="rose"
          trend={{ value: liveIncidents.length > 0 ? `${activeIncidentsCount} active` : '2 SEV2', positive: false }}
        />
        <MetricCard
          label="Telemetry Error Rate"
          value="0.08%"
          detail="In-flight HTTP & worker outcomes"
          icon={Activity}
          tone="cyan"
          trend={{ value: '0.14 pp', positive: true }}
        />
        <MetricCard
          label="Overall Platform Availability"
          value="99.96%"
          detail="Trailing 30-day SLA compliance"
          icon={Gauge}
          tone="violet"
          trend={{ value: '0.02 pp', positive: true }}
        />
      </section>

      {/* Traffic Chart & Side Cards */}
      <section className="grid grid-cols-1 items-start gap-4 2xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.9fr)]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="flex-row items-start justify-between gap-4 px-5 pb-1 pt-5 sm:px-6">
            <div>
              <CardTitle className="text-[15px]">Request traffic & error anomalies</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Volume throughput and error traces · rolling 24h</p>
            </div>
            <Badge variant="muted" className="hidden text-[10px] sm:inline-flex">24h window</Badge>
          </CardHeader>
          <CardContent className="px-3 pb-4 pt-4 sm:px-5">
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-2 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-2">
                <span className="size-2 rounded-full bg-sky-400" />
                Requests
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="size-2 rounded-full bg-violet-400" />
                Error events
              </span>
              <span className="ml-auto hidden items-center gap-1 text-[10px] text-slate-500 sm:inline-flex">
                <Cpu className="size-3" />
                Live Ingestion Stream
              </span>
            </div>
            <div className="h-[230px] w-full sm:h-[265px]" role="img" aria-label="Request volume and error events over 24 hours">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 6, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="requestFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="errorFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.14} />
                      <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 6" className="chart-grid" />
                  <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: '#718096', fontSize: 10 }} dy={10} minTickGap={20} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#718096', fontSize: 10 }} tickFormatter={(value: number) => `${value / 1000}k`} />
                  <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'rgba(148,163,184,0.2)', strokeDasharray: '3 4' }} />
                  <Area type="monotone" dataKey="requests" stroke="#38bdf8" strokeWidth={2} fill="url(#requestFill)" activeDot={{ r: 4, fill: '#7dd3fc', stroke: '#0c1623', strokeWidth: 2 }} />
                  <Area type="monotone" dataKey="errors" stroke="#a78bfa" strokeWidth={1.7} fill="url(#errorFill)" activeDot={{ r: 3, fill: '#c4b5fd', stroke: '#0c1623', strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-border/60 px-2 pt-3 text-[10px] text-slate-600">
              <span>Sampled across 2-hour intervals</span>
              <span>Telemetry synchronized</span>
            </div>
          </CardContent>
        </Card>

        <div className="grid min-w-0 gap-4 md:grid-cols-2 2xl:grid-cols-1">
          <ServiceHealthCard liveServices={liveServices} />
          <ActivityCard />
        </div>
      </section>

      {/* Incidents Table */}
      <IncidentTable liveIncidents={liveIncidents} />
    </div>
  )
}
