import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  History,
  LoaderCircle,
  RefreshCw,
  Server,
  ShieldAlert,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { useAuth } from '../auth/auth-context';
import { alertsApi } from './api';
import {
  AlertSeverityBadge,
  AlertStatusBadge,
  AlertTimeline,
  formatTimestamp,
  timeAgo,
} from './alert-ui';
import type { AlertDetail, AlertSeverity } from './types';

export function AlertDetailPage() {
  const { alertId } = useParams<{ alertId: string }>();
  const { activeWorkspaceId, workspaces, csrfToken } = useAuth();
  const navigate = useNavigate();

  const role = workspaces.find((w) => w.id === activeWorkspaceId)?.role;
  const canRespond = role === 'admin' || role === 'commander' || role === 'responder';

  const [alert, setAlert] = useState<AlertDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedFp, setCopiedFp] = useState(false);

  // Modals state
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveNote, setResolveNote] = useState('');
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalateTitle, setEscalateTitle] = useState('');
  const [escalateSeverity, setEscalateSeverity] = useState<AlertSeverity>('SEV2');
  const [actionInProgress, setActionInProgress] = useState(false);

  const loadAlert = async (silent = false) => {
    if (!activeWorkspaceId || !alertId) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await alertsApi.get(activeWorkspaceId, alertId);
      setAlert(data);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load alert details.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void loadAlert();
  }, [activeWorkspaceId, alertId]);

  const copyFingerprint = () => {
    if (!alert) return;
    navigator.clipboard.writeText(alert.fingerprint);
    setCopiedFp(true);
    setTimeout(() => setCopiedFp(false), 2000);
  };

  const handleAcknowledge = async () => {
    if (!activeWorkspaceId || !alert || !csrfToken) return;
    setActionInProgress(true);
    try {
      await alertsApi.acknowledge(activeWorkspaceId, alert.id, csrfToken);
      void loadAlert(true);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to acknowledge alert.');
    } finally {
      setActionInProgress(false);
    }
  };

  const handleSnooze = async (durationMinutes: number) => {
    if (!activeWorkspaceId || !alert || !csrfToken) return;
    setActionInProgress(true);
    try {
      await alertsApi.snooze(activeWorkspaceId, alert.id, durationMinutes, csrfToken);
      setSnoozeOpen(false);
      void loadAlert(true);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to snooze alert.');
    } finally {
      setActionInProgress(false);
    }
  };

  const handleResolve = async () => {
    if (!activeWorkspaceId || !alert || !csrfToken) return;
    setActionInProgress(true);
    try {
      await alertsApi.resolve(activeWorkspaceId, alert.id, resolveNote, csrfToken);
      setResolveOpen(false);
      setResolveNote('');
      void loadAlert(true);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to resolve alert.');
    } finally {
      setActionInProgress(false);
    }
  };

  const handleReopen = async () => {
    if (!activeWorkspaceId || !alert || !csrfToken) return;
    setActionInProgress(true);
    try {
      await alertsApi.reopen(activeWorkspaceId, alert.id, csrfToken);
      void loadAlert(true);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to reopen alert.');
    } finally {
      setActionInProgress(false);
    }
  };

  const handleEscalate = async () => {
    if (!activeWorkspaceId || !alert || !csrfToken) return;
    setActionInProgress(true);
    try {
      const updated = await alertsApi.createIncident(
        activeWorkspaceId,
        alert.id,
        {
          title: escalateTitle.trim() || alert.title,
          severity: escalateSeverity,
        },
        csrfToken
      );
      setEscalateOpen(false);
      if (updated.incident_id) {
        navigate(`/incidents/${updated.incident_id}`);
      } else {
        void loadAlert(true);
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to escalate alert into incident.');
    } finally {
      setActionInProgress(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground space-y-3">
        <LoaderCircle className="size-8 animate-spin text-primary" />
        <p className="text-xs">Loading operational alert details...</p>
      </div>
    );
  }

  if (error || !alert) {
    return (
      <div className="space-y-4">
        <Link
          to="/alerts"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Back to Alert Center
        </Link>
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-center text-destructive">
          <AlertCircle className="size-8 mx-auto mb-2" />
          <h3 className="font-semibold text-sm">Alert Not Found or Inaccessible</h3>
          <p className="text-xs mt-1 text-muted-foreground">{error ?? 'This alert may not exist in this workspace.'}</p>
        </div>
      </div>
    );
  }

  const sampleLogs: any[] = alert.data?.sample_logs || [];

  return (
    <div className="space-y-6">
      {/* Back Link */}
      <div className="flex items-center justify-between">
        <Link
          to="/alerts"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          Back to Alert Center
        </Link>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => void loadAlert()}
          className="size-8 p-0"
          title="Refresh alert"
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>

      {/* Main Alert Command Header */}
      <div className="rounded-xl border border-border/80 bg-card/60 p-5 shadow-sm space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <AlertSeverityBadge severity={alert.severity} />
              <AlertStatusBadge status={alert.status} />
              <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-foreground border border-border/50">
                {alert.occurrence_count} occurrences
              </span>
              {alert.service_name && (
                <span className="inline-flex items-center gap-1 rounded-md bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground border border-border/40">
                  <Server className="size-3" />
                  {alert.service_name}
                </span>
              )}
            </div>

            <h1 className="text-lg font-bold tracking-tight text-foreground sm:text-xl">
              {alert.title}
            </h1>

            {alert.description && (
              <p className="text-xs text-muted-foreground leading-relaxed">
                {alert.description}
              </p>
            )}
          </div>

          {/* Action Buttons */}
          {canRespond && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {alert.status === 'open' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAcknowledge}
                  disabled={actionInProgress}
                  className="gap-1.5 text-xs"
                >
                  <Eye className="size-3.5 text-sky-400" />
                  Acknowledge
                </Button>
              )}

              {alert.status !== 'resolved' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSnoozeOpen(true)}
                  disabled={actionInProgress}
                  className="gap-1.5 text-xs text-purple-400 border-purple-500/30 hover:bg-purple-950/20"
                >
                  <VolumeX className="size-3.5" />
                  Snooze
                </Button>
              )}

              {alert.status !== 'resolved' ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setResolveOpen(true);
                    setResolveNote('');
                  }}
                  disabled={actionInProgress}
                  className="gap-1.5 text-xs text-emerald-400 border-emerald-500/30 hover:bg-emerald-950/20"
                >
                  <CheckCircle2 className="size-3.5" />
                  Resolve
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReopen}
                  disabled={actionInProgress}
                  className="gap-1.5 text-xs text-orange-400 border-orange-500/30 hover:bg-orange-950/20"
                >
                  <Volume2 className="size-3.5" />
                  Reopen
                </Button>
              )}

              {/* Escalate to Incident */}
              {alert.incident_id ? (
                <Link to={`/incidents/${alert.incident_id}`}>
                  <Button
                    size="sm"
                    className="gap-1.5 text-xs bg-rose-600 hover:bg-rose-500 text-white"
                  >
                    <ShieldAlert className="size-3.5" />
                    Open {alert.incident_reference ?? 'Incident'}
                    <ExternalLink className="size-3 ml-1" />
                  </Button>
                </Link>
              ) : (
                <Button
                  size="sm"
                  onClick={() => {
                    setEscalateOpen(true);
                    setEscalateTitle(alert.title);
                    setEscalateSeverity(alert.severity);
                  }}
                  disabled={actionInProgress}
                  className="gap-1.5 text-xs bg-rose-600 hover:bg-rose-500 text-white"
                >
                  <ShieldAlert className="size-3.5" />
                  Escalate to Incident
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Escalation Link Status Banner */}
        {alert.incident_id && (
          <div className="flex items-center justify-between rounded-lg border border-rose-500/30 bg-rose-950/20 p-3 text-xs">
            <div className="flex items-center gap-2 text-rose-300">
              <ShieldAlert className="size-4" />
              <span>
                Escalated to <strong>{alert.incident_reference}</strong>. Active investigation and runbook orchestration enabled.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Link
                to={`/incidents/${alert.incident_id}`}
                className="font-medium text-rose-400 hover:underline"
              >
                View Incident
              </Link>
              <span className="text-muted-foreground">•</span>
              <Link
                to="/investigations"
                className="flex items-center gap-1 text-primary hover:underline"
              >
                <Sparkles className="size-3" />
                AI Investigation
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Main Grid: Details & Telemetry on left, Timeline on right */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column: Telemetry & Triggering Rules */}
        <div className="space-y-6 lg:col-span-2">
          {/* Metadata Card */}
          <Card className="border-border/70 bg-card/40">
            <CardHeader className="p-4 border-b border-border/60">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-mono">
                Trigger Details & Telemetry
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div>
                  <span className="text-[11px] text-muted-foreground block">
                    First Seen
                  </span>
                  <span className="text-xs font-mono font-medium text-foreground">
                    {formatTimestamp(alert.first_seen_at)}
                  </span>
                  <span className="text-[10px] text-muted-foreground block">
                    ({timeAgo(alert.first_seen_at)})
                  </span>
                </div>

                <div>
                  <span className="text-[11px] text-muted-foreground block">
                    Last Occurrence
                  </span>
                  <span className="text-xs font-mono font-medium text-foreground">
                    {formatTimestamp(alert.last_seen_at)}
                  </span>
                  <span className="text-[10px] text-muted-foreground block">
                    ({timeAgo(alert.last_seen_at)})
                  </span>
                </div>

                <div>
                  <span className="text-[11px] text-muted-foreground block">
                    Rule Reference
                  </span>
                  {alert.rule_name ? (
                    <span className="text-xs font-medium text-foreground">
                      {alert.rule_name}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">
                      Standalone trigger
                    </span>
                  )}
                </div>

                {alert.snoozed_until && (
                  <div>
                    <span className="text-[11px] text-purple-400 block">
                      Snoozed Until
                    </span>
                    <span className="text-xs font-mono text-purple-300">
                      {formatTimestamp(alert.snoozed_until)}
                    </span>
                  </div>
                )}

                {alert.resolved_at && (
                  <div>
                    <span className="text-[11px] text-emerald-400 block">
                      Resolved At
                    </span>
                    <span className="text-xs font-mono text-emerald-300">
                      {formatTimestamp(alert.resolved_at)}
                    </span>
                  </div>
                )}
              </div>

              {/* Fingerprint */}
              <div className="pt-2 border-t border-border/50">
                <span className="text-[11px] text-muted-foreground block mb-1">
                  Deterministic Fingerprint
                </span>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-muted/50 p-2 text-[11px] font-mono text-muted-foreground truncate border border-border/50">
                    {alert.fingerprint}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyFingerprint}
                    className="h-8 px-2 text-xs gap-1"
                  >
                    {copiedFp ? (
                      <Check className="size-3 text-emerald-400" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                    {copiedFp ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </div>

              {/* Resolution Note */}
              {alert.resolution_note && (
                <div className="pt-2 border-t border-border/50">
                  <span className="text-[11px] text-emerald-400 block mb-1 font-semibold">
                    Resolution Note
                  </span>
                  <p className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 p-3 text-xs text-emerald-300 leading-relaxed">
                    {alert.resolution_note}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sample Triggering Logs */}
          <Card className="border-border/70 bg-card/40">
            <CardHeader className="p-4 border-b border-border/60">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-mono flex items-center gap-1.5">
                  <FileText className="size-3.5" />
                  Correlated Telemetry Logs ({sampleLogs.length})
                </CardTitle>
                <Link
                  to="/logs"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  Logs Explorer
                  <ArrowLeft className="size-3 rotate-180" />
                </Link>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {sampleLogs.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  No sample logs recorded with this event trigger.
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {sampleLogs.map((log, idx) => (
                    <div key={idx} className="p-3.5 hover:bg-muted/20 transition-colors">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] text-rose-400 font-bold uppercase">
                          [{log.severity ?? 'ERROR'}]
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {log.timestamp ? formatTimestamp(log.timestamp) : '—'}
                        </span>
                      </div>
                      <p className="mt-1 font-mono text-xs text-foreground/90 leading-relaxed">
                        {log.message}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Alert Lifecycle Timeline */}
        <div className="space-y-6">
          <Card className="border-border/70 bg-card/40">
            <CardHeader className="p-4 border-b border-border/60">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-mono flex items-center gap-1.5">
                <History className="size-3.5" />
                Lifecycle Audit Trail ({alert.events?.length ?? 0})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <AlertTimeline events={alert.events || []} />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Escalate Modal */}
      {escalateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-border/80 bg-card p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="size-5 text-rose-400" />
                <h3 className="font-semibold text-sm text-foreground">
                  Escalate to Incident
                </h3>
              </div>
              <button onClick={() => setEscalateOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-foreground block mb-1">
                  Incident Title
                </label>
                <Input
                  value={escalateTitle}
                  onChange={(e) => setEscalateTitle(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-foreground block mb-1">
                  Incident Severity
                </label>
                <select
                  value={escalateSeverity}
                  onChange={(e) => setEscalateSeverity(e.target.value as AlertSeverity)}
                  className="w-full h-9 rounded-lg border border-border/70 bg-background px-3 text-xs text-foreground font-mono"
                >
                  <option value="SEV1">SEV1 - Critical Production Outage</option>
                  <option value="SEV2">SEV2 - Major Service Degradation</option>
                  <option value="SEV3">SEV3 - Minor Component Issue</option>
                  <option value="SEV4">SEV4 - Informational Telemetry</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEscalateOpen(false)}
                disabled={actionInProgress}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleEscalate}
                disabled={actionInProgress}
                className="gap-2 text-xs bg-rose-600 hover:bg-rose-500 text-white"
              >
                {actionInProgress && <LoaderCircle className="size-3.5 animate-spin" />}
                Confirm Escalation
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Snooze Modal */}
      {snoozeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-xl border border-border/80 bg-card p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <VolumeX className="size-5 text-purple-400" />
                <h3 className="font-semibold text-sm text-foreground">
                  Snooze Alert
                </h3>
              </div>
              <button onClick={() => setSnoozeOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSnooze(15)}
                disabled={actionInProgress}
                className="text-xs justify-start gap-2"
              >
                <Clock className="size-3.5" />
                15 Minutes
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSnooze(60)}
                disabled={actionInProgress}
                className="text-xs justify-start gap-2"
              >
                <Clock className="size-3.5" />
                1 Hour
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSnooze(240)}
                disabled={actionInProgress}
                className="text-xs justify-start gap-2"
              >
                <Clock className="size-3.5" />
                4 Hours
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSnooze(1440)}
                disabled={actionInProgress}
                className="text-xs justify-start gap-2"
              >
                <Clock className="size-3.5" />
                24 Hours
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Resolve Modal */}
      {resolveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-border/80 bg-card p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-emerald-400" />
                <h3 className="font-semibold text-sm text-foreground">
                  Resolve Alert
                </h3>
              </div>
              <button onClick={() => setResolveOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>

            <div>
              <label className="text-xs font-medium text-foreground block mb-1">
                Resolution Note (Optional)
              </label>
              <textarea
                value={resolveNote}
                onChange={(e) => setResolveNote(e.target.value)}
                placeholder="Describe what resolved the operational event..."
                rows={3}
                className="w-full rounded-lg border border-border/70 bg-background p-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 resize-none focus:outline-hidden focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setResolveOpen(false)}
                disabled={actionInProgress}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleResolve}
                disabled={actionInProgress}
                className="gap-2 text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                {actionInProgress && <LoaderCircle className="size-3.5 animate-spin" />}
                Confirm Resolution
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
