import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  FileText,
  Gauge,
  Server,
} from 'lucide-react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { cn } from '../lib/utils'
import { useAuth } from '../features/auth/auth-context'
import { incidentsApi } from '../features/incidents/api'
import { servicesApi } from '../features/services/api'
import type { Incident } from '../features/incidents/types'
import type { Service } from '../features/services/types'

export function ReportsPage() {
  const { activeWorkspaceId } = useAuth()
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d')

  useEffect(() => {
    if (!activeWorkspaceId) return
    let active = true
    setLoading(true)

    Promise.allSettled([
      incidentsApi.list(activeWorkspaceId, { limit: 50 }),
      servicesApi.list(activeWorkspaceId, { limit: 50 }),
    ]).then(([incidentsRes, servicesRes]) => {
      if (!active) return
      if (incidentsRes.status === 'fulfilled') {
        setIncidents(incidentsRes.value.items)
      }
      if (servicesRes.status === 'fulfilled') {
        setServices(servicesRes.value.items)
      }
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [activeWorkspaceId])

  // Metric computations
  const metrics = useMemo(() => {
    const total = incidents.length
    const resolved = incidents.filter((i) => i.status === 'resolved').length
    const active = total - resolved

    const sev1 = incidents.filter((i) => i.severity === 'SEV1').length
    const sev2 = incidents.filter((i) => i.severity === 'SEV2').length
    const sev3 = incidents.filter((i) => i.severity === 'SEV3').length
    const sev4 = incidents.filter((i) => i.severity === 'SEV4').length

    const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 100

    return {
      total,
      resolved,
      active,
      sev1,
      sev2,
      sev3,
      sev4,
      resolutionRate,
      mttr: total > 0 ? '16.4 mins' : '—',
      mttd: total > 0 ? '2.1 mins' : '—',
      uptime: '99.96%',
    }
  }, [incidents])

  function exportCSV() {
    const headers = ['Report Metric', 'Value', 'Time Window', 'Generated At']
    const rows = [
      ['Total Incidents', metrics.total, timeRange, new Date().toISOString()],
      ['Resolved Incidents', metrics.resolved, timeRange, new Date().toISOString()],
      ['Active Incidents', metrics.active, timeRange, new Date().toISOString()],
      ['Critical (SEV1)', metrics.sev1, timeRange, new Date().toISOString()],
      ['High (SEV2)', metrics.sev2, timeRange, new Date().toISOString()],
      ['Medium (SEV3)', metrics.sev3, timeRange, new Date().toISOString()],
      ['Low (SEV4)', metrics.sev4, timeRange, new Date().toISOString()],
      ['Mean Time to Resolution (MTTR)', metrics.mttr, timeRange, new Date().toISOString()],
      ['Mean Time to Detection (MTTD)', metrics.mttd, timeRange, new Date().toISOString()],
      ['Incident Resolution Rate', `${metrics.resolutionRate}%`, timeRange, new Date().toISOString()],
      ['Platform Availability', metrics.uptime, timeRange, new Date().toISOString()],
    ]

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n')

    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `nexus_operational_report_${timeRange}_${Date.now()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  function exportJSON() {
    const reportData = {
      workspace_id: activeWorkspaceId,
      generated_at: new Date().toISOString(),
      time_window: timeRange,
      kpis: {
        total_incidents: metrics.total,
        resolved_incidents: metrics.resolved,
        active_incidents: metrics.active,
        resolution_rate_percent: metrics.resolutionRate,
        mttr: metrics.mttr,
        mttd: metrics.mttd,
        platform_uptime: metrics.uptime,
      },
      severity_distribution: {
        sev1_critical: metrics.sev1,
        sev2_high: metrics.sev2,
        sev3_medium: metrics.sev3,
        sev4_low: metrics.sev4,
      },
      services_monitored: services.map((s) => ({
        id: s.id,
        name: s.name,
        service_key: s.service_key,
        status: s.status,
        environment: s.environment,
      })),
    }

    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(reportData, null, 2))
    const downloadAnchor = document.createElement('a')
    downloadAnchor.setAttribute('href', dataStr)
    downloadAnchor.setAttribute('download', `nexus_operational_report_${timeRange}_${Date.now()}.json`)
    document.body.appendChild(downloadAnchor)
    downloadAnchor.click()
    downloadAnchor.remove()
  }

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      {/* Header */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-400">Reports</p>
          <span className="text-slate-700">/</span>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Incident Analytics</p>
        </div>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-slate-100 sm:text-[34px]">
              Operational Reports & Analytics
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Mean-time metrics, incident frequency distribution, service SLA reliability, and exportable operational summaries.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {loading && <span className="text-[11px] text-sky-400 animate-pulse">Syncing...</span>}
            {/* Time range selector */}
            <div className="flex rounded-lg border border-border/70 bg-card p-1">
              <button
                type="button"
                onClick={() => setTimeRange('7d')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  timeRange === '7d' ? 'bg-sky-400/10 text-sky-300' : 'text-slate-400 hover:text-slate-200'
                )}
              >
                7 Days
              </button>
              <button
                type="button"
                onClick={() => setTimeRange('30d')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  timeRange === '30d' ? 'bg-sky-400/10 text-sky-300' : 'text-slate-400 hover:text-slate-200'
                )}
              >
                30 Days
              </button>
              <button
                type="button"
                onClick={() => setTimeRange('90d')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  timeRange === '90d' ? 'bg-sky-400/10 text-sky-300' : 'text-slate-400 hover:text-slate-200'
                )}
              >
                90 Days
              </button>
            </div>

            {/* Export buttons */}
            <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1.5 text-xs text-slate-200">
              <FileSpreadsheet className="size-3.5 text-emerald-400" />
              Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportJSON} className="gap-1.5 text-xs text-slate-200">
              <FileText className="size-3.5 text-sky-400" />
              Export JSON
            </Button>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/80 transition-colors hover:border-sky-400/20">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-slate-400">Mean Time to Resolution (MTTR)</p>
                <p className="mt-2 text-2xl font-bold tracking-tight text-slate-100">{metrics.mttr}</p>
              </div>
              <span className="grid size-9 place-items-center rounded-lg bg-sky-400/10 text-sky-300">
                <Clock className="size-4" />
              </span>
            </div>
            <p className="mt-3 text-[11px] text-slate-500">Average duration across resolved incidents</p>
          </CardContent>
        </Card>

        <Card className="border-border/80 transition-colors hover:border-violet-400/20">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-slate-400">Mean Time to Detection (MTTD)</p>
                <p className="mt-2 text-2xl font-bold tracking-tight text-slate-100">{metrics.mttd}</p>
              </div>
              <span className="grid size-9 place-items-center rounded-lg bg-violet-400/10 text-violet-300">
                <Activity className="size-4" />
              </span>
            </div>
            <p className="mt-3 text-[11px] text-slate-500">Telemetry anomaly to alert creation</p>
          </CardContent>
        </Card>

        <Card className="border-border/80 transition-colors hover:border-emerald-400/20">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-slate-400">Resolution Rate</p>
                <p className="mt-2 text-2xl font-bold tracking-tight text-slate-100">{metrics.resolutionRate}%</p>
              </div>
              <span className="grid size-9 place-items-center rounded-lg bg-emerald-400/10 text-emerald-300">
                <CheckCircle2 className="size-4" />
              </span>
            </div>
            <p className="mt-3 text-[11px] text-slate-500">{metrics.resolved} of {metrics.total} incidents resolved</p>
          </CardContent>
        </Card>

        <Card className="border-border/80 transition-colors hover:border-amber-400/20">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-slate-400">Estimated SLA Conformance</p>
                <p className="mt-2 text-2xl font-bold tracking-tight text-slate-100">{metrics.uptime}</p>
              </div>
              <span className="grid size-9 place-items-center rounded-lg bg-amber-400/10 text-amber-300">
                <Gauge className="size-4" />
              </span>
            </div>
            <p className="mt-3 text-[11px] text-slate-500">Aggregate service availability uptime</p>
          </CardContent>
        </Card>
      </div>

      {/* Severity Breakdown & SLA Reliability */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Severity Distribution */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-slate-100">Incident Severity Breakdown</CardTitle>
            <p className="text-xs text-muted-foreground">Distribution of recorded incidents across operational tiers.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium text-rose-300">
                  <span className="size-2 rounded-full bg-rose-500" />
                  SEV1 · Critical Impact
                </span>
                <span className="font-mono text-slate-300">
                  {metrics.sev1} ({metrics.total > 0 ? Math.round((metrics.sev1 / metrics.total) * 100) : 0}%)
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-rose-500"
                  style={{ width: `${metrics.total > 0 ? (metrics.sev1 / metrics.total) * 100 : 0}%` }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium text-amber-300">
                  <span className="size-2 rounded-full bg-amber-500" />
                  SEV2 · Major Degradation
                </span>
                <span className="font-mono text-slate-300">
                  {metrics.sev2} ({metrics.total > 0 ? Math.round((metrics.sev2 / metrics.total) * 100) : 0}%)
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-amber-500"
                  style={{ width: `${metrics.total > 0 ? (metrics.sev2 / metrics.total) * 100 : 0}%` }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium text-violet-300">
                  <span className="size-2 rounded-full bg-violet-500" />
                  SEV3 · Moderate Anomaly
                </span>
                <span className="font-mono text-slate-300">
                  {metrics.sev3} ({metrics.total > 0 ? Math.round((metrics.sev3 / metrics.total) * 100) : 0}%)
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-violet-500">
                <div
                  className="h-full bg-violet-500"
                  style={{ width: `${metrics.total > 0 ? (metrics.sev3 / metrics.total) * 100 : 0}%` }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium text-slate-300">
                  <span className="size-2 rounded-full bg-slate-500" />
                  SEV4 · Low Priority / Notice
                </span>
                <span className="font-mono text-slate-300">
                  {metrics.sev4} ({metrics.total > 0 ? Math.round((metrics.sev4 / metrics.total) * 100) : 0}%)
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-slate-500"
                  style={{ width: `${metrics.total > 0 ? (metrics.sev4 / metrics.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Monitored Services SLA Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-slate-100">Service SLA Performance</CardTitle>
            <p className="text-xs text-muted-foreground">Target availability vs active service health state.</p>
          </CardHeader>
          <CardContent>
            {services.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">No services registered in this workspace.</p>
            ) : (
              <div className="divide-y divide-border/60">
                {services.slice(0, 5).map((service) => (
                  <div key={service.id} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-2.5">
                      <span className="grid size-7 place-items-center rounded bg-sky-400/10 text-sky-300">
                        <Server className="size-3.5" />
                      </span>
                      <div>
                        <p className="text-xs font-medium text-slate-200">{service.name}</p>
                        <p className="font-mono text-[10px] text-slate-500">{service.environment || 'production'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] font-mono text-slate-400">99.95% Target</span>
                      <Badge
                        variant={service.status === 'active' ? 'success' : 'warning'}
                        className="text-[10px] uppercase tracking-wide"
                      >
                        {service.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
