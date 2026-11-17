import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  AlertCircle,
  AlertTriangle,
  Bug,
  Check,
  Copy,
  Filter,
  Info,
  Maximize2,
  Minimize2,
  Terminal,
  X,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '../../components/ui/button'
import { Card, CardContent } from '../../components/ui/card'
import { cn } from '../../lib/utils'
import type { LogRecord, LogSeverity, LogTimeBucket } from './types'

export const SEVERITY_CONFIG: Record<
  LogSeverity,
  {
    label: string
    color: string
    bgColor: string
    borderColor: string
    dotColor: string
    badgeClass: string
    chartColor: string
    icon: typeof Info
  }
> = {
  FATAL: {
    label: 'FATAL',
    color: 'text-rose-200',
    bgColor: 'bg-rose-500/20',
    borderColor: 'border-rose-500/40',
    dotColor: 'bg-rose-400',
    badgeClass: 'bg-rose-950/80 text-rose-200 border-rose-500/50 shadow-sm shadow-rose-950/40',
    chartColor: '#f43f5e',
    icon: AlertCircle,
  },
  ERROR: {
    label: 'ERROR',
    color: 'text-red-300',
    bgColor: 'bg-red-500/15',
    borderColor: 'border-red-500/30',
    dotColor: 'bg-red-400',
    badgeClass: 'bg-red-950/70 text-red-300 border-red-500/40',
    chartColor: '#ef4444',
    icon: AlertCircle,
  },
  WARN: {
    label: 'WARN',
    color: 'text-amber-300',
    bgColor: 'bg-amber-500/15',
    borderColor: 'border-amber-500/30',
    dotColor: 'bg-amber-400',
    badgeClass: 'bg-amber-950/60 text-amber-300 border-amber-500/35',
    chartColor: '#f59e0b',
    icon: AlertTriangle,
  },
  INFO: {
    label: 'INFO',
    color: 'text-sky-300',
    bgColor: 'bg-sky-500/15',
    borderColor: 'border-sky-500/30',
    dotColor: 'bg-sky-400',
    badgeClass: 'bg-sky-950/50 text-sky-300 border-sky-500/30',
    chartColor: '#38bdf8',
    icon: Info,
  },
  DEBUG: {
    label: 'DEBUG',
    color: 'text-slate-400',
    bgColor: 'bg-slate-500/15',
    borderColor: 'border-slate-500/25',
    dotColor: 'bg-slate-400',
    badgeClass: 'bg-slate-900/80 text-slate-400 border-slate-700',
    chartColor: '#94a3b8',
    icon: Bug,
  },
}

export function LogSeverityBadge({ severity, className }: { severity: LogSeverity; className?: string }) {
  const conf = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.INFO
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wider border transition-colors',
        conf.badgeClass,
        className
      )}
    >
      <span className={cn('size-1.5 rounded-full shrink-0', conf.dotColor)} />
      {conf.label}
    </span>
  )
}

export function formatLogTime(timestamp: string): { local: string; utc: string; relative: string } {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return { local: '—', utc: '—', relative: '—' }
  }

  const local = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
  }).format(date)

  const utc = date.toISOString()

  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000)
  let relative = ''
  if (diffSec < 60) relative = `${Math.max(0, diffSec)}s ago`
  else if (diffSec < 3600) relative = `${Math.floor(diffSec / 60)}m ago`
  else if (diffSec < 86400) relative = `${Math.floor(diffSec / 3600)}h ago`
  else relative = `${Math.floor(diffSec / 86400)}d ago`

  return { local, utc, relative }
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-400 hover:bg-white/[0.08] hover:text-slate-200 transition-colors"
      title={`Copy ${label}`}
    >
      {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  )
}

export function AttributesViewer({ attributes }: { attributes: Record<string, unknown> }) {
  const [search, setSearch] = useState('')
  const [copiedAll, setCopiedAll] = useState(false)
  const entries = Object.entries(attributes || {})

  const filtered = entries.filter(([key, val]) => {
    if (!search) return true
    const s = search.toLowerCase()
    return key.toLowerCase().includes(s) || String(val).toLowerCase().includes(s)
  })

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(attributes, null, 2))
      setCopiedAll(true)
      setTimeout(() => setCopiedAll(false), 2000)
    } catch {
      /* ignore */
    }
  }

  if (entries.length === 0) {
    return <p className="text-xs italic text-slate-500">No structured attributes attached.</p>
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter attributes..."
          className="h-7 w-48 rounded border border-border bg-background/60 px-2 text-xs text-foreground placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400"
        />
        <button
          type="button"
          onClick={copyAll}
          className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-sky-300 transition-colors"
        >
          {copiedAll ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
          <span>{copiedAll ? 'Copied JSON' : 'Copy JSON'}</span>
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto rounded-lg border border-border/80 bg-black/40 font-mono text-xs">
        <table className="w-full text-left">
          <tbody>
            {filtered.map(([key, val]) => {
              const valStr = typeof val === 'object' ? JSON.stringify(val) : String(val)
              const valType = typeof val
              return (
                <tr key={key} className="border-b border-border/40 last:border-0 hover:bg-white/[0.02]">
                  <td className="w-1/3 select-all px-3 py-1.5 font-semibold text-sky-300/90">{key}</td>
                  <td className="w-2/3 select-all px-3 py-1.5 text-slate-300 break-all">
                    {valType === 'boolean' ? (
                      <span className={val ? 'text-emerald-400' : 'text-rose-400'}>{valStr}</span>
                    ) : valType === 'number' ? (
                      <span className="text-amber-300">{valStr}</span>
                    ) : (
                      valStr
                    )}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={2} className="px-3 py-3 text-center text-slate-500">
                  No attributes match “{search}”
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function SeverityDistributionBar({
  counts,
  total,
  onSelectSeverity,
  activeSeverity,
}: {
  counts: Record<string, number>
  total: number
  onSelectSeverity?: (sev: LogSeverity | undefined) => void
  activeSeverity?: LogSeverity
}) {
  const severities: LogSeverity[] = ['FATAL', 'ERROR', 'WARN', 'INFO', 'DEBUG']

  return (
    <div className="space-y-2">
      {/* Segmented bar */}
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-800/80">
        {total === 0 ? (
          <div className="h-full w-full bg-slate-800" />
        ) : (
          severities.map((sev) => {
            const count = counts[sev] || 0
            if (count === 0) return null
            const pct = (count / total) * 100
            const conf = SEVERITY_CONFIG[sev]
            return (
              <div
                key={sev}
                style={{ width: `${pct}%`, backgroundColor: conf.chartColor }}
                className="h-full transition-all hover:opacity-80"
                title={`${sev}: ${count.toLocaleString()} (${pct.toFixed(1)}%)`}
              />
            )
          })
        )}
      </div>

      {/* Interactive legend chips */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {severities.map((sev) => {
          const count = counts[sev] || 0
          const conf = SEVERITY_CONFIG[sev]
          const isSelected = activeSeverity === sev
          return (
            <button
              key={sev}
              type="button"
              onClick={() => onSelectSeverity?.(isSelected ? undefined : sev)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-all',
                isSelected
                  ? 'bg-white/[0.12] ring-1 ring-sky-400 font-semibold text-slate-100 shadow-sm'
                  : 'bg-white/[0.03] text-slate-400 hover:bg-white/[0.07] hover:text-slate-200'
              )}
            >
              <span className={cn('size-2 rounded-full shrink-0', conf.dotColor)} />
              <span className="font-mono">{sev}</span>
              <span className="font-semibold text-slate-200">{count.toLocaleString()}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function LogVolumeChart({
  buckets,
}: {
  buckets: LogTimeBucket[]
}) {
  if (!buckets || buckets.length === 0) {
    return (
      <div className="flex h-36 items-center justify-center text-xs text-slate-500">
        No log activity in this time range
      </div>
    )
  }

  const chartData = buckets.map((b) => {
    const d = new Date(b.timestamp)
    const timeLabel = Number.isNaN(d.getTime())
      ? ''
      : new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
    return {
      time: timeLabel,
      fullTime: b.timestamp,
      total: b.count,
      DEBUG: b.severity_breakdown?.DEBUG || 0,
      INFO: b.severity_breakdown?.INFO || 0,
      WARN: b.severity_breakdown?.WARN || 0,
      ERROR: b.severity_breakdown?.ERROR || 0,
      FATAL: b.severity_breakdown?.FATAL || 0,
      raw: b,
    }
  })

  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey="time"
            stroke="#64748b"
            fontSize={10}
            tickLine={false}
            axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
          />
          <YAxis
            stroke="#64748b"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload
              return (
                <div className="rounded-lg border border-border bg-popover/95 p-2.5 text-xs shadow-xl backdrop-blur-md">
                  <p className="font-semibold text-slate-200">{p.time} UTC</p>
                  <p className="mt-1 font-mono text-[11px] text-slate-400">
                    Total: <span className="font-bold text-slate-100">{p.total}</span> logs
                  </p>
                  <div className="mt-1.5 space-y-0.5 border-t border-border/50 pt-1 text-[10px]">
                    {p.FATAL > 0 && <p className="text-rose-300">FATAL: {p.FATAL}</p>}
                    {p.ERROR > 0 && <p className="text-red-400">ERROR: {p.ERROR}</p>}
                    {p.WARN > 0 && <p className="text-amber-400">WARN: {p.WARN}</p>}
                    {p.INFO > 0 && <p className="text-sky-300">INFO: {p.INFO}</p>}
                    {p.DEBUG > 0 && <p className="text-slate-400">DEBUG: {p.DEBUG}</p>}
                  </div>
                </div>
              )
            }}
          />
          <Bar dataKey="FATAL" stackId="a" fill={SEVERITY_CONFIG.FATAL.chartColor} />
          <Bar dataKey="ERROR" stackId="a" fill={SEVERITY_CONFIG.ERROR.chartColor} />
          <Bar dataKey="WARN" stackId="a" fill={SEVERITY_CONFIG.WARN.chartColor} />
          <Bar dataKey="INFO" stackId="a" fill={SEVERITY_CONFIG.INFO.chartColor} />
          <Bar dataKey="DEBUG" stackId="a" fill={SEVERITY_CONFIG.DEBUG.chartColor} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function LogDrawer({
  log,
  open,
  onOpenChange,
  onFilterByTrace,
}: {
  log: LogRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onFilterByTrace?: (traceId: string) => void
}) {
  const [wrap, setWrap] = useState(true)

  if (!log) return null
  const times = formatLogTime(log.timestamp)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-2xl flex-col border-l border-border bg-sidebar p-0 text-sidebar-foreground shadow-2xl transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right duration-300 focus:outline-none">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/80 px-6 py-4">
            <div className="flex items-center gap-3">
              <LogSeverityBadge severity={log.severity} />
              <span className="font-mono text-xs font-semibold text-slate-300">
                {log.service?.name ?? 'Unknown Service'}
              </span>
              <span className="text-xs text-slate-500">· {times.relative}</span>
            </div>
            <div className="flex items-center gap-1">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-100 transition-colors"
                  aria-label="Close drawer"
                >
                  <X className="size-4" />
                </button>
              </Dialog.Close>
            </div>
          </div>

          <Dialog.Title className="sr-only">Log Record Detail</Dialog.Title>
          <Dialog.Description className="sr-only">
            Detailed inspection of log message, trace ID, and structured attributes.
          </Dialog.Description>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
            {/* Log Message Box */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Log Message</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setWrap(!wrap)}
                    className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200"
                  >
                    {wrap ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
                    <span>{wrap ? 'No Wrap' : 'Wrap'}</span>
                  </button>
                  <CopyButton text={log.message} label="Copy Message" />
                </div>
              </div>
              <div
                className={cn(
                  'rounded-lg border border-border bg-black/60 p-3.5 font-mono text-xs leading-relaxed text-slate-200 select-all',
                  wrap ? 'whitespace-pre-wrap break-words' : 'overflow-x-auto whitespace-pre'
                )}
              >
                {log.message}
              </div>
            </div>

            {/* Metadata Grid */}
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Record Metadata</span>
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border/80 bg-white/[0.02] p-4 text-xs">
                <div>
                  <span className="block text-slate-500">Log ID</span>
                  <div className="mt-1 flex items-center gap-1 font-mono text-slate-300">
                    <span className="truncate">{log.id}</span>
                    <CopyButton text={log.id} label="" />
                  </div>
                </div>

                <div>
                  <span className="block text-slate-500">Service</span>
                  <div className="mt-1 flex items-center gap-1.5 font-mono text-slate-300">
                    <span className="font-semibold text-sky-300">{log.service?.name ?? '—'}</span>
                    <span className="text-slate-500">({log.service?.service_key ?? '—'})</span>
                  </div>
                </div>

                <div>
                  <span className="block text-slate-500">Timestamp (Local)</span>
                  <p className="mt-1 font-mono text-slate-300">{times.local}</p>
                </div>

                <div>
                  <span className="block text-slate-500">Timestamp (UTC)</span>
                  <div className="mt-1 flex items-center gap-1 font-mono text-slate-300">
                    <span>{times.utc}</span>
                    <CopyButton text={times.utc} label="" />
                  </div>
                </div>

                {log.trace_id && (
                  <div className="col-span-2 border-t border-border/40 pt-2.5">
                    <span className="block text-slate-500">Distributed Trace ID</span>
                    <div className="mt-1 flex flex-wrap items-center gap-2 font-mono">
                      <span className="rounded bg-sky-500/10 px-2 py-1 font-semibold text-sky-300 border border-sky-500/25">
                        {log.trace_id}
                      </span>
                      <CopyButton text={log.trace_id} label="Copy Trace" />
                      {onFilterByTrace && (
                        <button
                          type="button"
                          onClick={() => {
                            onFilterByTrace(log.trace_id!)
                            onOpenChange(false)
                          }}
                          className="inline-flex items-center gap-1 rounded bg-white/[0.06] px-2 py-1 text-[11px] text-sky-300 hover:bg-sky-500/20 transition-colors"
                        >
                          <Filter className="size-3" /> Filter by this trace
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Structured Attributes */}
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Structured Attributes</span>
              <AttributesViewer attributes={log.attributes} />
            </div>

            {/* Full JSON representation */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Raw JSON Record</span>
                <CopyButton text={JSON.stringify(log, null, 2)} label="Copy Record" />
              </div>
              <pre className="max-h-52 overflow-y-auto rounded-lg border border-border bg-black/50 p-3 font-mono text-[11px] text-slate-400">
                {JSON.stringify(log, null, 2)}
              </pre>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function LogSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-1.5" aria-label="Loading logs" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex h-11 items-center gap-4 rounded-lg border border-border/60 bg-white/[0.02] px-4 animate-pulse"
        >
          <div className="h-4 w-16 rounded bg-slate-800" />
          <div className="h-4 w-14 rounded bg-slate-800" />
          <div className="h-4 w-24 rounded bg-slate-800" />
          <div className="h-4 flex-1 rounded bg-slate-800/60" />
          <div className="h-4 w-20 rounded bg-slate-800" />
        </div>
      ))}
    </div>
  )
}

export function LogEmptyState({
  hasFilters,
  onClearFilters,
  onSeedDemoLogs,
  seeding,
}: {
  hasFilters: boolean
  onClearFilters: () => void
  onSeedDemoLogs?: () => void
  seeding?: boolean
}) {
  return (
    <Card className="border-dashed bg-card/40">
      <CardContent className="flex min-h-64 flex-col items-center justify-center px-5 py-12 text-center">
        <span className="grid size-12 place-items-center rounded-xl border border-sky-400/20 bg-sky-400/[0.06] text-sky-300">
          <Terminal className="size-6" />
        </span>
        <h2 className="mt-4 text-base font-semibold text-slate-100">
          {hasFilters ? 'No logs match active filters' : 'No logs recorded in this workspace'}
        </h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          {hasFilters
            ? 'Try widening the time window, clearing search terms, or removing severity constraints.'
            : 'Structured log events will stream here once ingested from your services or background tasks.'}
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          {hasFilters && (
            <Button variant="secondary" size="sm" onClick={onClearFilters}>
              Clear all filters
            </Button>
          )}
          {onSeedDemoLogs && (
            <Button variant="outline" size="sm" onClick={onSeedDemoLogs} disabled={seeding}>
              {seeding ? 'Ingesting demo telemetry...' : 'Ingest sample telemetry logs'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
