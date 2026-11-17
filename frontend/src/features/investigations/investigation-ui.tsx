import {
  AlertCircle,
  AlertTriangle,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  Clock,
  Compass,
  Database,
  FileText,
  Layers,
  ListOrdered,
  LoaderCircle,
  Network,
  RefreshCw,
  Server,
  Sparkles,
  Workflow,
  XCircle,
} from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { Card, CardContent } from '../../components/ui/card'
import type {
  EvidenceType,
  InvestigationStatus,
  ProviderStatus,
  RecommendationStatus,
} from './types'

export function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString)
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date)
  } catch {
    return isoString
  }
}

export function InvestigationStatusBadge({ status }: { status: InvestigationStatus }) {
  switch (status) {
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
          <CheckCircle2 className="size-3.5" />
          Completed
        </span>
      )
    case 'running':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-0.5 text-xs font-medium text-sky-400">
          <LoaderCircle className="size-3.5 animate-spin" />
          Investigating
        </span>
      )
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-400">
          <Clock className="size-3.5" />
          Pending
        </span>
      )
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/20 bg-rose-500/10 px-2.5 py-0.5 text-xs font-medium text-rose-400">
          <AlertCircle className="size-3.5" />
          Failed
        </span>
      )
  }
}

export function EvidenceTypeBadge({ type }: { type: EvidenceType }) {
  switch (type) {
    case 'log':
      return (
        <Badge variant="default">
          <FileText className="mr-1 size-3" />
          Log Pattern
        </Badge>
      )
    case 'service':
      return (
        <Badge variant="violet">
          <Server className="mr-1 size-3" />
          Service Topology
        </Badge>
      )
    case 'incident':
      return (
        <Badge variant="warning">
          <AlertTriangle className="mr-1 size-3" />
          Incident Event
        </Badge>
      )
    case 'metric':
      return (
        <Badge variant="muted">
          <Network className="mr-1 size-3" />
          Telemetry
        </Badge>
      )
  }
}

export function RecommendationStatusBadge({ status }: { status: RecommendationStatus }) {
  switch (status) {
    case 'pending_approval':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-300">
          <Clock className="size-3.5" />
          Pending Approval
        </span>
      )
    case 'approved':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
          <Check className="size-3.5" />
          Approved
        </span>
      )
    case 'rejected':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-500/20 bg-slate-500/10 px-2.5 py-0.5 text-xs font-medium text-slate-400">
          <XCircle className="size-3.5" />
          Rejected
        </span>
      )
  }
}

export function ConfidenceMeter({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) {
    return <span className="text-xs text-muted-foreground">Evaluating…</span>
  }

  const pct = Math.round(score * 100)
  const isHigh = pct >= 75
  const isMed = pct >= 50

  const colorClass = isHigh
    ? 'text-emerald-400'
    : isMed
      ? 'text-amber-400'
      : 'text-rose-400'

  const barColor = isHigh
    ? 'bg-emerald-500'
    : isMed
      ? 'bg-amber-500'
      : 'bg-rose-500'

  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full ${barColor} transition-all duration-500`}
          style={{ width: `${Math.min(100, Math.max(5, pct))}%` }}
        />
      </div>
      <span className={`font-mono text-xs font-semibold ${colorClass}`}>
        {pct}%
      </span>
    </div>
  )
}

export function ProviderStatusBanner({
  status,
  onRefresh,
}: {
  status: ProviderStatus | null
  onRefresh?: () => void
}) {
  if (!status) return null

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-xs ${
        status.is_available
          ? 'border-emerald-500/20 bg-emerald-500/[0.04] text-slate-300'
          : 'border-amber-500/25 bg-amber-500/[0.05] text-amber-200'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={`size-2 rounded-full ${
            status.is_available ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]' : 'bg-amber-400'
          }`}
        />
        <div className="flex items-center gap-1.5 font-medium">
          <Bot className="size-3.5 text-muted-foreground" />
          <span>Provider:</span>
          <span className="font-mono text-foreground capitalize">{status.provider}</span>
          <span className="text-slate-600">·</span>
          <span className="text-muted-foreground font-mono">{status.model}</span>
        </div>
        <span className="text-muted-foreground">({status.message})</span>
      </div>

      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          className="flex items-center gap-1 text-slate-400 hover:text-slate-200 transition-colors"
          title="Recheck provider health"
        >
          <RefreshCw className="size-3" />
          Refresh
        </button>
      )}
    </div>
  )
}

export function WorkflowProgression({ currentStatus }: { currentStatus: InvestigationStatus }) {
  const steps = [
    { id: 'plan', label: 'Planner', icon: Compass },
    { id: 'collect', label: 'Collector', icon: Database },
    { id: 'analyze', label: 'Log Analyzer', icon: FileText },
    { id: 'hypothesize', label: 'Hypotheses', icon: Brain },
    { id: 'evaluate', label: 'Evaluator', icon: ListOrdered },
    { id: 'impact', label: 'Impact Analyzer', icon: Layers },
    { id: 'recommend', label: 'Recommendations', icon: Sparkles },
    { id: 'summary', label: 'Executive Report', icon: Workflow },
  ]

  const isCompleted = currentStatus === 'completed'
  const isFailed = currentStatus === 'failed'

  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
      <CardContent className="p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Workflow className="size-3.5 text-sky-400" />
            <span>LangGraph Agentic Pipeline (8 Nodes)</span>
          </div>
          <InvestigationStatusBadge status={currentStatus} />
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {steps.map((step, idx) => {
            const Icon = step.icon
            const isDone = isCompleted
            const isCurrent = currentStatus === 'running' && idx === 3

            return (
              <div
                key={step.id}
                className={`flex flex-col items-center justify-center rounded-lg border p-2.5 text-center transition-all ${
                  isDone
                    ? 'border-emerald-500/25 bg-emerald-500/[0.05] text-emerald-300'
                    : isCurrent
                      ? 'border-sky-500/40 bg-sky-500/10 text-sky-300 animate-pulse'
                      : isFailed && idx >= 2
                        ? 'border-rose-500/20 bg-rose-500/[0.03] text-rose-300/70'
                        : 'border-border/40 bg-background/40 text-muted-foreground'
                }`}
              >
                <div className="mb-1 flex size-7 items-center justify-center rounded-full bg-slate-900/80">
                  {isDone ? (
                    <Check className="size-3.5 text-emerald-400" />
                  ) : (
                    <Icon className="size-3.5" />
                  )}
                </div>
                <span className="text-[11px] font-medium leading-tight">{step.label}</span>
                <span className="text-[9px] text-muted-foreground mt-0.5">Node {idx + 1}</span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

export function InvestigationSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-10 w-48 rounded bg-muted/40" />
      <div className="h-28 rounded-lg border border-border/40 bg-muted/20" />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="h-24 rounded-lg bg-muted/20" />
        <div className="h-24 rounded-lg bg-muted/20" />
        <div className="h-24 rounded-lg bg-muted/20" />
      </div>
      <div className="h-64 rounded-lg border border-border/40 bg-muted/20" />
    </div>
  )
}
