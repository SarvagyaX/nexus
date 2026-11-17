import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  ArrowRight,
  Bot,
  Brain,
  CheckCircle2,
  Filter,
  Layers,
  LoaderCircle,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Card, CardContent } from '../../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui/dialog'
import { useAuth } from '../auth/auth-context'
import { incidentsApi } from '../incidents/api'
import type { Incident } from '../incidents/types'
import { InvestigationApiError, investigationsApi } from './api'
import {
  ConfidenceMeter,
  formatTimestamp,
  InvestigationSkeleton,
  InvestigationStatusBadge,
  ProviderStatusBanner,
} from './investigation-ui'
import type {
  InvestigationStatus,
  InvestigationSummary,
  ProviderStatus,
} from './types'

export function InvestigationsPage() {
  const navigate = useNavigate()
  const { activeWorkspaceId, workspaces, csrfToken } = useAuth()
  const role = workspaces.find((w) => w.id === activeWorkspaceId)?.role
  const canStart = role === 'admin' || role === 'commander' || role === 'responder'

  const [investigations, setInvestigations] = useState<InvestigationSummary[]>([])
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshIndex, setRefreshIndex] = useState(0)

  // Launch Modal State
  const [modalOpen, setModalOpen] = useState(false)
  const [activeIncidents, setActiveIncidents] = useState<Incident[]>([])
  const [selectedIncidentId, setSelectedIncidentId] = useState('')
  const [launching, setLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeWorkspaceId) return
    let active = true

    async function loadData() {
      setLoading(true)
      setError(null)
      try {
        const [invRes, pStatus] = await Promise.all([
          investigationsApi.list(activeWorkspaceId!, {
            status: statusFilter !== 'all' ? (statusFilter as InvestigationStatus) : undefined,
          }),
          investigationsApi.getProviderStatus(activeWorkspaceId!).catch(() => null),
        ])
        if (active) {
          setInvestigations(invRes.items)
          setProviderStatus(pStatus)
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof InvestigationApiError
              ? err.message
              : 'Failed to load AI investigations. Please check your connection and retry.'
          )
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadData()
    return () => {
      active = false
    }
  }, [activeWorkspaceId, statusFilter, refreshIndex])

  // Open modal & load incidents
  async function openLaunchModal() {
    if (!activeWorkspaceId) return
    setModalOpen(true)
    setLaunchError(null)
    setSelectedIncidentId('')
    try {
      const res = await incidentsApi.list(activeWorkspaceId, { limit: 50 })
      setActiveIncidents(res.items)
      if (res.items.length > 0) {
        setSelectedIncidentId(res.items[0].id)
      }
    } catch {
      setLaunchError('Could not retrieve active incidents list.')
    }
  }

  async function handleStartInvestigation(e: FormEvent) {
    e.preventDefault()
    if (!activeWorkspaceId || !selectedIncidentId || !csrfToken) return
    setLaunching(true)
    setLaunchError(null)
    try {
      const newInv = await investigationsApi.start(
        activeWorkspaceId,
        selectedIncidentId,
        csrfToken
      )
      setModalOpen(false)
      navigate(`/investigations/${newInv.id}`)
    } catch (err) {
      setLaunchError(
        err instanceof InvestigationApiError
          ? err.message
          : 'Could not launch investigation. Verify backend and provider status.'
      )
    } finally {
      setLaunching(false)
    }
  }

  const filtered = investigations.filter((inv) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      (inv.incident_title && inv.incident_title.toLowerCase().includes(q)) ||
      (inv.summary && inv.summary.toLowerCase().includes(q)) ||
      inv.id.toLowerCase().includes(q)
    )
  })

  // KPI Computations
  const totalCount = investigations.length
  const completedCount = investigations.filter((i) => i.status === 'completed').length
  const runningCount = investigations.filter((i) => i.status === 'running').length
  const avgConfidence =
    completedCount > 0
      ? Math.round(
          (investigations.reduce((acc, i) => acc + (i.confidence_score || 0), 0) /
            completedCount) *
            100
        )
      : null

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 sm:space-y-7">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
              <Brain className="size-4" />
            </span>
            <span className="text-xs font-semibold tracking-wider text-sky-400 uppercase">
              Milestone 7 Engine
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            AI Investigation Center
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            LangGraph-driven operational root-cause analysis, blast radius estimation, and human-reviewed remediation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshIndex((v) => v + 1)}
            disabled={loading}
          >
            <RefreshCw className={`mr-1.5 size-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          {canStart && (
            <Button size="sm" onClick={() => void openLaunchModal()}>
              <Sparkles className="mr-1.5 size-3.5 text-sky-300" />
              New Investigation
            </Button>
          )}
        </div>
      </div>

      {/* Provider Status Indicator */}
      <ProviderStatusBanner
        status={providerStatus}
        onRefresh={() => setRefreshIndex((v) => v + 1)}
      />

      {/* KPI Cards */}
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Total Investigations</span>
              <Brain className="size-4 text-sky-400" />
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight text-foreground">
              {totalCount}
            </p>
            <span className="text-[11px] text-muted-foreground">Across all incidents</span>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Active Analysis</span>
              <LoaderCircle className="size-4 text-sky-400" />
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight text-sky-400">
              {runningCount}
            </p>
            <span className="text-[11px] text-muted-foreground">Nodes executing</span>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Completed</span>
              <CheckCircle2 className="size-4 text-emerald-400" />
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight text-emerald-400">
              {completedCount}
            </p>
            <span className="text-[11px] text-muted-foreground">Reports generated</span>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Avg Root Cause Confidence</span>
              <Sparkles className="size-4 text-indigo-400" />
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight text-indigo-400">
              {avgConfidence !== null ? `${avgConfidence}%` : '—'}
            </p>
            <span className="text-[11px] text-muted-foreground">Calibrated evidence score</span>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by incident title or hypothesis…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 w-full rounded-lg border border-input bg-background/70 pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="size-3.5 text-muted-foreground" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-lg border border-input bg-background/70 px-3 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30"
          >
            <option value="all">All Statuses</option>
            <option value="completed">Completed</option>
            <option value="running">Investigating</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-rose-500/25 bg-rose-500/[0.06] p-4 text-xs text-rose-200"
        >
          <AlertCircle className="size-4 shrink-0 mt-0.5 text-rose-400" />
          <div>
            <p className="font-medium">Investigation service error</p>
            <p className="mt-0.5 text-rose-300/80">{error}</p>
          </div>
        </div>
      )}

      {/* Main List */}
      {loading ? (
        <InvestigationSkeleton />
      ) : filtered.length === 0 ? (
        <Card className="border-border/60 bg-card/40 text-center py-12">
          <CardContent className="space-y-3">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-slate-900 border border-slate-800 text-slate-500">
              <Brain className="size-6" />
            </div>
            <h2 className="text-base font-semibold text-foreground">No investigations found</h2>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              {searchQuery || statusFilter !== 'all'
                ? 'Try adjusting your search criteria or status filter.'
                : 'No incidents have been investigated with AI yet in this workspace.'}
            </p>
            {canStart && (
              <Button size="sm" onClick={() => void openLaunchModal()} className="mt-2">
                <Sparkles className="mr-1.5 size-3.5" />
                Launch First Investigation
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((inv) => (
            <Card
              key={inv.id}
              className="border-border/60 bg-card/60 backdrop-blur-sm transition-all hover:border-sky-500/30 hover:bg-card/90"
            >
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <InvestigationStatusBadge status={inv.status} />
                      {inv.incident_severity && (
                        <span className="font-mono text-[10px] font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 rounded">
                          {inv.incident_severity}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">·</span>
                      <time className="text-[11px] text-muted-foreground">
                        {formatTimestamp(inv.created_at)}
                      </time>
                    </div>

                    <Link
                      to={`/investigations/${inv.id}`}
                      className="group inline-flex items-center gap-2 text-base font-semibold text-foreground hover:text-sky-400 transition-colors"
                    >
                      <span>{inv.incident_title || 'Incident Investigation'}</span>
                      <ArrowRight className="size-4 opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0 text-sky-400" />
                    </Link>

                    {inv.summary ? (
                      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                        {inv.summary.replace(/[#*]/g, '')}
                      </p>
                    ) : inv.error_message ? (
                      <p className="text-xs text-rose-400 line-clamp-1">{inv.error_message}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">Investigation in progress…</p>
                    )}

                    <div className="flex flex-wrap items-center gap-4 pt-1 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Layers className="size-3 text-sky-400" />
                        {inv.evidence_count} Evidence items
                      </span>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <Brain className="size-3 text-violet-400" />
                        {inv.hypotheses_count} Hypotheses
                      </span>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <Sparkles className="size-3 text-amber-400" />
                        {inv.recommendations_count} Recommendations
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-row items-center justify-between gap-4 border-t border-border/40 pt-3 lg:flex-col lg:items-end lg:border-t-0 lg:pt-0">
                    <div>
                      <div className="text-[10px] text-muted-foreground text-right mb-1">
                        Engine Confidence
                      </div>
                      <ConfidenceMeter score={inv.confidence_score} />
                    </div>

                    <Link to={`/investigations/${inv.id}`}>
                      <Button variant="outline" size="sm" className="h-8 text-xs">
                        Inspect
                        <ArrowRight className="ml-1 size-3" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Launch Investigation Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg p-5 sm:p-6">
          <DialogTitle className="text-lg flex items-center gap-2">
            <Sparkles className="size-5 text-sky-400" />
            Launch AI Investigation
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            The LangGraph engine will gather real logs, inspect service health, formulate root-cause hypotheses, and propose remediation actions.
          </DialogDescription>

          <form onSubmit={handleStartInvestigation} className="mt-4 space-y-4">
            <div>
              <label htmlFor="incident-select" className="block text-xs font-medium text-slate-300 mb-1.5">
                Target Incident <span className="text-rose-400">*</span>
              </label>
              {activeIncidents.length === 0 ? (
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
                  No incidents found in workspace. Create an incident first in the Incidents module.
                </div>
              ) : (
                <select
                  id="incident-select"
                  value={selectedIncidentId}
                  onChange={(e) => setSelectedIncidentId(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background/80 px-3 py-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30"
                  required
                >
                  {activeIncidents.map((inc) => (
                    <option key={inc.id} value={inc.id}>
                      [{inc.reference}] {inc.severity} · {inc.title}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {launchError && (
              <div className="flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/[0.05] p-3 text-xs text-rose-300">
                <AlertCircle className="size-4 shrink-0 text-rose-400" />
                {launchError}
              </div>
            )}

            <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                size="sm"
                type="button"
                disabled={launching}
                onClick={() => setModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                type="submit"
                disabled={launching || !selectedIncidentId || activeIncidents.length === 0}
              >
                {launching ? (
                  <>
                    <LoaderCircle className="mr-1.5 size-3.5 animate-spin" />
                    Executing LangGraph…
                  </>
                ) : (
                  <>
                    <Bot className="mr-1.5 size-3.5" />
                    Run Investigation
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
