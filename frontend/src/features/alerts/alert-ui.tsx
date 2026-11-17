import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Eye,
  History,
  Info,
  Radio,
  ShieldAlert,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import type {
  AlertEvent,
  AlertRuleCondition,
  AlertSeverity,
  AlertStatus,
} from './types';

export function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return isoString;
  }
}

export function timeAgo(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffSec < 60) return `${Math.max(1, diffSec)}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return isoString;
  }
}

export function AlertStatusBadge({ status }: { status: AlertStatus }) {
  switch (status) {
    case 'open':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/25 bg-rose-500/10 px-2.5 py-0.5 text-xs font-semibold text-rose-400">
          <span className="size-1.5 rounded-full bg-rose-500 animate-ping" />
          Open
        </span>
      );
    case 'acknowledged':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/25 bg-sky-500/10 px-2.5 py-0.5 text-xs font-medium text-sky-400">
          <Eye className="size-3" />
          Acknowledged
        </span>
      );
    case 'snoozed':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/25 bg-purple-500/10 px-2.5 py-0.5 text-xs font-medium text-purple-300">
          <VolumeX className="size-3" />
          Snoozed
        </span>
      );
    case 'resolved':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
          <CheckCircle2 className="size-3" />
          Resolved
        </span>
      );
  }
}

export function AlertSeverityBadge({ severity }: { severity: AlertSeverity }) {
  switch (severity) {
    case 'SEV1':
      return (
        <span className="inline-flex items-center gap-1 rounded bg-rose-950/80 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-rose-300 border border-rose-500/40">
          <ShieldAlert className="size-3 text-rose-400" />
          SEV1 Critical
        </span>
      );
    case 'SEV2':
      return (
        <span className="inline-flex items-center gap-1 rounded bg-orange-950/80 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-orange-300 border border-orange-500/40">
          <AlertCircle className="size-3 text-orange-400" />
          SEV2 Major
        </span>
      );
    case 'SEV3':
      return (
        <span className="inline-flex items-center gap-1 rounded bg-amber-950/70 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-amber-300 border border-amber-500/30">
          <AlertTriangle className="size-3 text-amber-400" />
          SEV3 Minor
        </span>
      );
    case 'SEV4':
      return (
        <span className="inline-flex items-center gap-1 rounded bg-blue-950/70 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-blue-300 border border-blue-500/30">
          <Info className="size-3 text-blue-400" />
          SEV4 Info
        </span>
      );
  }
}

export function AlertConditionBadge({ condition }: { condition: AlertRuleCondition }) {
  switch (condition) {
    case 'error_count':
      return (
        <Badge variant="danger" className="border-rose-500/30 bg-rose-500/10 text-rose-300 text-[11px]">
          Error Count Threshold
        </Badge>
      );
    case 'fatal_log':
      return (
        <Badge variant="danger" className="border-red-500/40 bg-red-500/15 text-red-300 text-[11px]">
          Fatal Log Detector
        </Badge>
      );
    case 'error_rate':
      return (
        <Badge variant="warning" className="border-amber-500/30 bg-amber-500/10 text-amber-300 text-[11px]">
          Error Rate (%)
        </Badge>
      );
    case 'repeated_failures':
      return (
        <Badge variant="violet" className="border-violet-500/30 bg-violet-500/10 text-violet-300 text-[11px]">
          Repeated Failures
        </Badge>
      );
  }
}

export function LiveStreamPill({ isConnected }: { isConnected: boolean }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-xs">
      <span className="relative flex size-2">
        {isConnected ? (
          <>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </>
        ) : (
          <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
        )}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground flex items-center gap-1">
        <Radio className="size-3" />
        {isConnected ? 'Real-Time SSE Connected' : 'Telemetry Polling Mode'}
      </span>
    </div>
  );
}

export function MetricKpiCard({
  title,
  value,
  subtext,
  icon: Icon,
  variant = 'default',
}: {
  title: string;
  value: number | string;
  subtext: string;
  icon: any;
  variant?: 'default' | 'danger' | 'warning' | 'info' | 'success';
}) {
  const borderVariants = {
    default: 'border-border/60 bg-card/50',
    danger: 'border-rose-500/30 bg-rose-950/20 text-rose-300',
    warning: 'border-amber-500/30 bg-amber-950/20 text-amber-300',
    info: 'border-sky-500/30 bg-sky-950/20 text-sky-300',
    success: 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300',
  };

  const iconColors = {
    default: 'text-muted-foreground',
    danger: 'text-rose-400',
    warning: 'text-amber-400',
    info: 'text-sky-400',
    success: 'text-emerald-400',
  };

  return (
    <div className={`rounded-xl border p-4 shadow-sm backdrop-blur-sm ${borderVariants[variant]}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <Icon className={`size-4 ${iconColors[variant]}`} />
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold tracking-tight text-foreground font-mono">
          {value}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{subtext}</p>
    </div>
  );
}

export function AlertTimeline({ events }: { events: AlertEvent[] }) {
  if (!events || events.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-muted-foreground">
        No lifecycle events recorded for this alert yet.
      </div>
    );
  }

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case 'alert.created':
        return <AlertCircle className="size-3.5 text-rose-400" />;
      case 'alert.occurrence_incremented':
        return <History className="size-3.5 text-amber-400" />;
      case 'alert.acknowledged':
        return <Eye className="size-3.5 text-sky-400" />;
      case 'alert.snoozed':
        return <VolumeX className="size-3.5 text-purple-400" />;
      case 'alert.resolved':
        return <CheckCircle2 className="size-3.5 text-emerald-400" />;
      case 'alert.reopened':
      case 'alert.reopened_from_snooze':
        return <Volume2 className="size-3.5 text-orange-400" />;
      case 'alert.incident_created':
      case 'alert.incident_linked':
        return <ShieldAlert className="size-3.5 text-rose-400" />;
      default:
        return <Info className="size-3.5 text-muted-foreground" />;
    }
  };

  return (
    <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-border/60">
      {events.map((ev) => (
        <div key={ev.id} className="relative group">
          <div className="absolute -left-[23px] top-1 rounded-full bg-background p-1 border border-border group-hover:border-primary/50 transition-colors">
            {getEventIcon(ev.event_type)}
          </div>
          <div className="rounded-lg border border-border/50 bg-muted/20 p-3 transition-colors hover:border-border hover:bg-muted/30">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-foreground font-mono">
                {ev.event_type}
              </span>
              <span className="text-[11px] text-muted-foreground font-mono">
                {formatTimestamp(ev.created_at)}
              </span>
            </div>
            {ev.message && (
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                {ev.message}
              </p>
            )}
            {ev.payload && Object.keys(ev.payload).length > 0 && (
              <pre className="mt-2 rounded bg-background/80 p-2 text-[11px] font-mono text-muted-foreground overflow-x-auto border border-border/40">
                {JSON.stringify(ev.payload, null, 2)}
              </pre>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
