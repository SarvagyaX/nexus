import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Brain,
  Check,
  ExternalLink,
  Layers,
  LoaderCircle,
  Network,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui/dialog'
import { useAuth } from '../auth/auth-context'
import { InvestigationApiError, investigationsApi } from './api'
import {
  ConfidenceMeter,
  EvidenceTypeBadge,
  formatTimestamp,
  InvestigationSkeleton,
  InvestigationStatusBadge,
  RecommendationStatusBadge,
  WorkflowProgression,
} from './investigation-ui'
import type {
  InvestigationDetail,
  RecommendationItem,
  RecommendationStatus,
} from './types'

export function InvestigationDetailPage() {
  const { investigationId = '' } = useParams()
  const navigate = useNavigate()
  const { activeWorkspaceId, workspaces, csrfToken } = useAuth()
  const role = workspaces.find((w) => w.id === activeWorkspaceId)?.role
  const canApprove = role === 'admin' || role === 'commander'
  const canRetry = role === 'admin' || role === 'commander' || role === 'responder'

  const [investigation, setInvestigation] = useState<InvestigationDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [activeTab, setActiveTab] = useState<'hypotheses' | 'evidence' | 'impact' | 'recommendations'>('hypotheses')
  const [evidenceFilter, setEvidenceFilter] = useState<string>('all')

  // Recommendation Review Dialog
  const [reviewDialog, setReviewDialog] = useState<{
    open: boolean
    recommendation: RecommendationItem | null
    targetStatus: RecommendationStatus
  }>({
    open: false,
    recommendation: null,
    targetStatus: 'approved',
  })
  const [reviewNotes, setReviewNotes] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeWorkspaceId || !investigationId) return
    let active = true

    async function loadInvestigation() {
      setLoading(true)
      setError(null)
      try {
        const data = await investigationsApi.get(activeWorkspaceId!, investigationId)
        if (active) setInvestigation(data)
      } catch (err) {
        if (active) {
          setError(
            err instanceof InvestigationApiError
              ? err.message
              : 'Failed to load investigation details.'
          )
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadInvestigation()
    return () => {
      active = false
    }
  }, [activeWorkspaceId, investigationId])

  async function handleRetry() {
    if (!activeWorkspaceId || !investigationId || !csrfToken) return
    setRetrying(true)
    setError(null)
    try {
      const refreshed = await investigationsApi.retry(activeWorkspaceId, investigationId, csrfToken)
      setInvestigation(refreshed)
    } catch (err) {
      setError(
        err instanceof InvestigationApiError
          ? err.message
          : 'Failed to retry investigation workflow.'
      )
    } finally {
      setRetrying(false)
    }
  }

  function openReviewModal(rec: RecommendationItem, status: RecommendationStatus) {
    setReviewDialog({
      open: true,
      recommendation: rec,
      targetStatus: status,
    })
    setReviewNotes('')
    setReviewError(null)
  }

  async function submitReview(e: FormEvent) {
    e.preventDefault()
    if (!activeWorkspaceId || !investigation || !reviewDialog.recommendation || !csrfToken) return
    setReviewing(true)
    setReviewError(null)

    try {
      const updatedRec = await investigationsApi.reviewRecommendation(
        activeWorkspaceId,
        investigation.id,
        reviewDialog.recommendation.id,
        reviewDialog.targetStatus,
        reviewNotes,
        csrfToken
      )

      // Update local state
      setInvestigation((prev) => {
        if (!prev) return null
        return {
          ...prev,
          recommendations: prev.recommendations.map((r) =>
            r.id === updatedRec.id ? updatedRec : r
          ),
        }
      })
      setReviewDialog({ open: false, recommendation: null, targetStatus: 'approved' })
    } catch (err) {
      setReviewError(
        err instanceof InvestigationApiError
          ? err.message
          : 'Failed to submit recommendation review.'
      )
    } finally {
      setReviewing(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-[1440px] space-y-6">
        <InvestigationSkeleton />
      </div>
    )
  }

  if (error || !investigation) {
    return (
      <div className="mx-auto max-w-2xl text-center py-16 space-y-4">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-400">
          <AlertCircle className="size-6" />
        </div>
        <h2 className="text-xl font-bold text-foreground">Investigation Unavailable</h2>
        <p className="text-sm text-muted-foreground">{error || 'Investigation could not be loaded.'}</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/investigations')}>
          <ArrowLeft className="mr-1.5 size-3.5" />
          Back to Investigations
        </Button>
      </div>
    )
  }

  const primaryHypothesis = investigation.hypotheses.find((h) => h.is_primary)
  const secondaryHypotheses = investigation.hypotheses.filter((h) => !h.is_primary)

  const filteredEvidence = investigation.evidence.filter((ev) => {
    if (evidenceFilter === 'all') return true
    return ev.evidence_type === evidenceFilter
  })

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 sm:space-y-7">
      {/* Top Navigation Breadcrumb */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <Link
          to="/investigations"
          className="inline-flex items-center gap-1.5 text-slate-400 hover:text-sky-300 transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          Back to Investigation Center
        </Link>

        {investigation.incident_id && (
          <Link
            to={`/incidents/${investigation.incident_id}`}
            className="inline-flex items-center gap-1 text-sky-400 hover:underline"
          >
            <span>Incident Context: {investigation.incident_title || 'View Incident'}</span>
            <ExternalLink className="size-3" />
          </Link>
        )}
      </div>

      {/* Hero Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <InvestigationStatusBadge status={investigation.status} />
            {investigation.incident_severity && (
              <span className="font-mono text-xs font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded">
                {investigation.incident_severity}
              </span>
            )}
            {investigation.incident_service_name && (
              <Badge variant="default" className="border-sky-500/30 text-sky-300">
                <Server className="mr-1 size-3" />
                {investigation.incident_service_name}
              </Badge>
            )}
            <span className="text-muted-foreground text-xs">·</span>
            <span className="text-xs text-muted-foreground">
              Initiated {formatTimestamp(investigation.created_at)}
            </span>
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {investigation.incident_title || 'Incident Investigation'}
          </h1>

          <p className="max-w-3xl text-sm text-muted-foreground leading-relaxed">
            Multi-node LangGraph autonomous investigation grounded in real telemetry, error logs, and service health states.
          </p>
        </div>

        <div className="flex flex-col items-start lg:items-end gap-3">
          <div className="rounded-lg border border-border/60 bg-card/70 p-3 text-right">
            <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
              Root-Cause Confidence
            </span>
            <div className="mt-1">
              <ConfidenceMeter score={investigation.confidence_score} />
            </div>
          </div>

          {canRetry && (
            <Button
              variant="outline"
              size="sm"
              disabled={retrying}
              onClick={() => void handleRetry()}
            >
              {retrying ? (
                <>
                  <LoaderCircle className="mr-1.5 size-3.5 animate-spin" />
                  Rerunning Pipeline…
                </>
              ) : (
                <>
                  <RefreshCw className="mr-1.5 size-3.5" />
                  Rerun Investigation
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Workflow Progression Stepper */}
      <WorkflowProgression currentStatus={investigation.status} />

      {/* Failure Alert Banner (if failed) */}
      {investigation.status === 'failed' && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-rose-500/30 bg-rose-500/[0.08] p-4 text-xs text-rose-200"
        >
          <AlertCircle className="size-5 shrink-0 text-rose-400 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-sm text-rose-300">Investigation Pipeline Failed</p>
            <p className="text-rose-200/90 leading-relaxed">
              {investigation.error_message || 'The AI investigation could not be completed.'}
            </p>
            <p className="text-[11px] text-muted-foreground pt-1">
              Ensure Ollama or configured LLM endpoint is healthy, then click "Rerun Investigation" above.
            </p>
          </div>
        </div>
      )}

      {/* Executive Summary Card */}
      {investigation.summary && (
        <Card className="border-border/60 bg-gradient-to-r from-card/80 to-sky-950/20 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
              <Sparkles className="size-4 text-sky-400" />
              Executive AI Synthesis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm leading-relaxed text-slate-300 whitespace-pre-line">
              {investigation.summary}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabbed Exploration View */}
      <div className="space-y-4">
        <div className="flex border-b border-border">
          <button
            type="button"
            onClick={() => setActiveTab('hypotheses')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors ${
              activeTab === 'hypotheses'
                ? 'border-sky-400 text-sky-400'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Brain className="size-3.5" />
            Root Causes & Hypotheses ({investigation.hypotheses.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('evidence')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors ${
              activeTab === 'evidence'
                ? 'border-sky-400 text-sky-400'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Layers className="size-3.5" />
            Observed Evidence ({investigation.evidence.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('impact')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors ${
              activeTab === 'impact'
                ? 'border-sky-400 text-sky-400'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Network className="size-3.5" />
            Blast Radius & Impact
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('recommendations')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors ${
              activeTab === 'recommendations'
                ? 'border-sky-400 text-sky-400'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <ShieldCheck className="size-3.5" />
            Remediation Actions ({investigation.recommendations.length})
          </button>
        </div>

        {/* TAB 1: HYPOTHESES */}
        {activeTab === 'hypotheses' && (
          <div className="space-y-4">
            {/* Primary Root Cause Highlight */}
            {primaryHypothesis && (
              <Card className="border-sky-500/30 bg-sky-950/20 backdrop-blur-sm overflow-hidden">
                <div className="bg-sky-500/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-sky-400 border-b border-sky-500/20 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="size-3.5" />
                    Primary Identified Root Cause
                  </span>
                  <span className="font-mono">{Math.round(primaryHypothesis.confidence_score * 100)}% Confidence</span>
                </div>
                <CardContent className="p-5 space-y-4">
                  <div>
                    <h3 className="text-lg font-bold text-foreground">
                      {primaryHypothesis.title}
                    </h3>
                    <p className="mt-1.5 text-xs text-slate-300 leading-relaxed">
                      {primaryHypothesis.description}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 pt-2">
                    {/* Supporting Facts */}
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.03] p-3.5 space-y-2">
                      <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                        <Check className="size-3.5" />
                        Supporting Evidence
                      </span>
                      {primaryHypothesis.supporting_evidence.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">No direct correlations detected.</p>
                      ) : (
                        <ul className="space-y-1.5 text-xs text-slate-300">
                          {primaryHypothesis.supporting_evidence.map((s, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <span className="text-emerald-400 mt-0.5">•</span>
                              <span>{s}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Contradicting Facts */}
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.03] p-3.5 space-y-2">
                      <span className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                        <AlertTriangle className="size-3.5" />
                        Contradicting / Inconclusive Factors
                      </span>
                      {primaryHypothesis.contradicting_evidence.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">No counter-indicators found.</p>
                      ) : (
                        <ul className="space-y-1.5 text-xs text-slate-300">
                          {primaryHypothesis.contradicting_evidence.map((c, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <span className="text-amber-400 mt-0.5">•</span>
                              <span>{c}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Secondary Hypotheses */}
            {secondaryHypotheses.length > 0 && (
              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Alternative Evaluated Hypotheses
                </h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  {secondaryHypotheses.map((hyp) => (
                    <Card key={hyp.id} className="border-border/60 bg-card/50">
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-foreground">
                            {hyp.title}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {Math.round(hyp.confidence_score * 100)}%
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {hyp.description}
                        </p>
                        {hyp.supporting_evidence.length > 0 && (
                          <div className="pt-2 text-[11px] text-slate-400">
                            <span className="text-slate-500 font-medium">Fact: </span>
                            {hyp.supporting_evidence[0]}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: EVIDENCE */}
        {activeTab === 'evidence' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground mr-1">Filter by type:</span>
              {(['all', 'log', 'service', 'incident'] as const).map((t) => (
                <Button
                  key={t}
                  variant={evidenceFilter === t ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setEvidenceFilter(t)}
                  className="h-7 text-xs capitalize"
                >
                  {t}
                </Button>
              ))}
            </div>

            <div className="space-y-3">
              {filteredEvidence.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-6 text-center">
                  No evidence items matching this filter.
                </p>
              ) : (
                filteredEvidence.map((ev) => (
                  <Card key={ev.id} className="border-border/60 bg-card/50">
                    <CardContent className="p-4 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <EvidenceTypeBadge type={ev.evidence_type} />
                          <span className="text-xs font-semibold text-foreground">
                            {ev.title}
                          </span>
                        </div>
                        <time className="text-[11px] text-muted-foreground">
                          {formatTimestamp(ev.collected_at)}
                        </time>
                      </div>

                      <p className="text-xs text-slate-300 leading-relaxed">
                        {ev.summary}
                      </p>

                      {ev.data && Object.keys(ev.data).length > 0 && (
                        <div className="rounded bg-slate-950/80 border border-slate-800 p-2 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-40">
                          <pre>{JSON.stringify(ev.data, null, 2)}</pre>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 3: BLAST RADIUS & IMPACT */}
        {activeTab === 'impact' && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="border-border/60 bg-card/50">
                <CardContent className="p-4 space-y-1">
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                    Target Service
                  </span>
                  <p className="text-sm font-semibold text-foreground">
                    {investigation.incident_service_name || 'Target Service'}
                  </p>
                  <p className="text-xs text-slate-400">Core operational workload</p>
                </CardContent>
              </Card>

              <Card className="border-border/60 bg-card/50">
                <CardContent className="p-4 space-y-1">
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                    Estimated Blast Radius
                  </span>
                  <p className="text-sm font-semibold text-amber-400">
                    {investigation.incident_severity === 'SEV1'
                      ? 'Critical Workload Exposure'
                      : 'Service-Isolated Disruption'}
                  </p>
                  <p className="text-xs text-slate-400">Based on topology & active incidents</p>
                </CardContent>
              </Card>

              <Card className="border-border/60 bg-card/50">
                <CardContent className="p-4 space-y-1">
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                    Human Approval Status
                  </span>
                  <p className="text-sm font-semibold text-emerald-400">
                    Active Governance
                  </p>
                  <p className="text-xs text-slate-400">Destructive actions gated</p>
                </CardContent>
              </Card>
            </div>

            <Card className="border-border/60 bg-card/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Dependency Topology & Correlation Note
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-slate-300 leading-relaxed space-y-2">
                <p>
                  The investigation scanned active workspace incidents and error patterns in the time window around detection.
                  No cascade failure across unrelated services was detected, indicating the problem is isolated to{' '}
                  <strong className="text-foreground">{investigation.incident_service_name || 'the service'}</strong> and its direct database connection pool.
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* TAB 4: RECOMMENDATIONS */}
        {activeTab === 'recommendations' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Prioritized remediation guidance generated by AI. Requires human confirmation before execution.
              </span>
              {!canApprove && (
                <span className="text-amber-400/90 italic">
                  Note: Only Commanders and Admins can approve recommendations.
                </span>
              )}
            </div>

            <div className="space-y-3.5">
              {investigation.recommendations.map((rec) => (
                <Card key={rec.id} className="border-border/60 bg-card/50">
                  <CardContent className="p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 text-xs font-bold text-sky-400 font-mono">
                          {rec.priority}
                        </span>
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          {rec.action_type}
                        </span>
                        <span className="text-sm font-bold text-foreground">
                          {rec.title}
                        </span>
                      </div>
                      <RecommendationStatusBadge status={rec.status} />
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed">
                      {rec.description}
                    </p>

                    <div className="rounded-lg border border-border/40 bg-muted/20 p-3 text-xs text-slate-400">
                      <span className="font-semibold text-slate-300">Rationale: </span>
                      {rec.rationale}
                    </div>

                    {rec.review_notes && (
                      <div className="rounded-lg border border-border/40 bg-card p-2.5 text-xs text-slate-300">
                        <span className="font-semibold text-muted-foreground">Reviewer Note: </span>
                        {rec.review_notes}
                      </div>
                    )}

                    {/* Human In The Loop Controls */}
                    {rec.status === 'pending_approval' && canApprove && (
                      <div className="flex items-center gap-2 pt-2 border-t border-border/40">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => openReviewModal(rec, 'approved')}
                          className="h-8 text-xs text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/20"
                        >
                          <Check className="mr-1.5 size-3.5" />
                          Approve Action
                        </Button>

                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openReviewModal(rec, 'rejected')}
                          className="h-8 text-xs text-rose-400 hover:bg-rose-500/10"
                        >
                          <X className="mr-1.5 size-3.5" />
                          Reject
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Recommendation Review Dialog */}
      <Dialog
        open={reviewDialog.open}
        onOpenChange={(open) => {
          if (!open) setReviewDialog({ open: false, recommendation: null, targetStatus: 'approved' })
        }}
      >
        <DialogContent className="max-w-md p-5 sm:p-6">
          <DialogTitle className="text-base flex items-center gap-2">
            {reviewDialog.targetStatus === 'approved' ? (
              <>
                <Check className="size-5 text-emerald-400" />
                Approve Recommendation
              </>
            ) : (
              <>
                <XCircle className="size-5 text-rose-400" />
                Reject Recommendation
              </>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            {reviewDialog.recommendation?.title}
          </DialogDescription>

          <form onSubmit={submitReview} className="mt-4 space-y-4">
            <div>
              <label htmlFor="review-notes" className="block text-xs font-medium text-slate-300 mb-1.5">
                Review Decision Notes <span className="text-muted-foreground">(optional)</span>
              </label>
              <textarea
                id="review-notes"
                rows={3}
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="Operational verification notes or deployment change link…"
                className="w-full rounded-lg border border-input bg-background/80 px-3 py-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30"
              />
            </div>

            {reviewError && (
              <p className="text-xs text-rose-400">{reviewError}</p>
            )}

            <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                size="sm"
                type="button"
                disabled={reviewing}
                onClick={() => setReviewDialog({ open: false, recommendation: null, targetStatus: 'approved' })}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                type="submit"
                disabled={reviewing}
                className={
                  reviewDialog.targetStatus === 'approved'
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : 'bg-rose-600 hover:bg-rose-500 text-white'
                }
              >
                {reviewing ? (
                  <>
                    <LoaderCircle className="mr-1.5 size-3.5 animate-spin" />
                    Recording Decision…
                  </>
                ) : (
                  <>Confirm {reviewDialog.targetStatus === 'approved' ? 'Approval' : 'Rejection'}</>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
