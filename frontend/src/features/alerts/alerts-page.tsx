import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  Layers,
  ListFilter,
  LoaderCircle,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  Sliders,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { useAuth } from '../auth/auth-context';
import { servicesApi } from '../services/api';
import type { Service } from '../services/types';
import { alertsApi, subscribeAlertStream } from './api';
import {
  AlertSeverityBadge,
  AlertStatusBadge,
  LiveStreamPill,
  MetricKpiCard,
  timeAgo,
} from './alert-ui';
import type {
  AlertGroup,
  AlertSeverity,
  AlertStats,
  AlertStatus,
  AlertSummary,
} from './types';

export function AlertsPage() {
  const { activeWorkspaceId, workspaces, csrfToken } = useAuth();
  const navigate = useNavigate();

  const role = workspaces.find((w) => w.id === activeWorkspaceId)?.role;
  const canRespond = role === 'admin' || role === 'commander' || role === 'responder';

  // Filters & State
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AlertStatus>('open');
  const [severityFilter, setSeverityFilter] = useState<'all' | AlertSeverity>('all');
  const [serviceFilter, setServiceFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'flat' | 'grouped'>('flat');

  // Data states
  const [alerts, setAlerts] = useState<AlertSummary[]>([]);
  const [groups, setGroups] = useState<AlertGroup[]>([]);
  const [stats, setStats] = useState<AlertStats | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evalResult, setEvalResult] = useState<string | null>(null);
  const [isSseConnected, setIsSseConnected] = useState(false);

  // Modals state
  const [snoozeAlertTarget, setSnoozeAlertTarget] = useState<AlertSummary | null>(null);
  const [resolveAlertTarget, setResolveAlertTarget] = useState<AlertSummary | null>(null);
  const [resolveNote, setResolveNote] = useState('');
  const [escalateTarget, setEscalateTarget] = useState<AlertSummary | null>(null);
  const [escalateTitle, setEscalateTitle] = useState('');
  const [escalateSeverity, setEscalateSeverity] = useState<AlertSeverity>('SEV2');
  const [actionInProgress, setActionInProgress] = useState(false);

  // Load initial data
  const loadData = async (silent = false) => {
    if (!activeWorkspaceId) return;
    if (!silent) setLoading(true);
    setError(null);

    try {
      const [alertsRes, statsRes, groupsRes, servicesRes] = await Promise.all([
        alertsApi.list(activeWorkspaceId, {
          status: statusFilter === 'all' ? undefined : statusFilter,
          severity: severityFilter === 'all' ? undefined : severityFilter,
          service_id: serviceFilter === 'all' ? undefined : serviceFilter,
          q: search.trim() || undefined,
          limit: 100,
        }),
        alertsApi.stats(activeWorkspaceId),
        alertsApi.groups(activeWorkspaceId),
        servicesApi.list(activeWorkspaceId, { limit: 100 }).catch(() => ({ items: [] })),
      ]);

      setAlerts(alertsRes.items);
      setStats(statsRes);
      setGroups(groupsRes.groups);
      setServices(servicesRes.items);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load telemetry alerts.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [activeWorkspaceId, statusFilter, severityFilter, serviceFilter]);

  // Search debounce
  useEffect(() => {
    const handler = setTimeout(() => {
      void loadData(true);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  // Real-time SSE Stream Subscription
  useEffect(() => {
    if (!activeWorkspaceId) return;

    setIsSseConnected(true);
    const unsubscribe = subscribeAlertStream(
      activeWorkspaceId,
      () => {
        // Refresh alert list and stats silently
        void loadData(true);
      },
      () => {
        setIsSseConnected(false);
      }
    );

    return () => {
      unsubscribe();
      setIsSseConnected(false);
    };
  }, [activeWorkspaceId]);

  // Action handlers
  const handleEvaluate = async () => {
    if (!activeWorkspaceId || !csrfToken) return;
    setEvaluating(true);
    setEvalResult(null);
    try {
      const res = await alertsApi.evaluate(activeWorkspaceId, undefined, csrfToken);
      setEvalResult(
        `Evaluated ${res.evaluated_rules} rules: ${res.new_alerts_count} new alerts generated, ${res.updated_alerts_count} updated.`
      );
      void loadData(true);
    } catch (err: any) {
      setError(err?.message ?? 'Rule evaluation failed.');
    } finally {
      setEvaluating(false);
    }
  };

  const handleAcknowledge = async (alertId: string) => {
    if (!activeWorkspaceId || !csrfToken) return;
    try {
      await alertsApi.acknowledge(activeWorkspaceId, alertId, csrfToken);
      void loadData(true);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to acknowledge alert.');
    }
  };

  const handleSnooze = async (alertId: string, durationMinutes: number) => {
    if (!activeWorkspaceId || !csrfToken) return;
    setActionInProgress(true);
    try {
      await alertsApi.snooze(activeWorkspaceId, alertId, durationMinutes, csrfToken);
      setSnoozeAlertTarget(null);
      void loadData(true);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to snooze alert.');
    } finally {
      setActionInProgress(false);
    }
  };

  const handleResolve = async () => {
    if (!activeWorkspaceId || !resolveAlertTarget || !csrfToken) return;
    setActionInProgress(true);
    try {
      await alertsApi.resolve(activeWorkspaceId, resolveAlertTarget.id, resolveNote, csrfToken);
      setResolveAlertTarget(null);
      setResolveNote('');
      void loadData(true);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to resolve alert.');
    } finally {
      setActionInProgress(false);
    }
  };

  const handleReopen = async (alertId: string) => {
    if (!activeWorkspaceId || !csrfToken) return;
    try {
      await alertsApi.reopen(activeWorkspaceId, alertId, csrfToken);
      void loadData(true);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to reopen alert.');
    }
  };

  const handleEscalate = async () => {
    if (!activeWorkspaceId || !escalateTarget || !csrfToken) return;
    setActionInProgress(true);
    try {
      const updated = await alertsApi.createIncident(
        activeWorkspaceId,
        escalateTarget.id,
        {
          title: escalateTitle.trim() || escalateTarget.title,
          severity: escalateSeverity,
        },
        csrfToken
      );
      setEscalateTarget(null);
      void loadData(true);

      if (updated.incident_id) {
        navigate(`/incidents/${updated.incident_id}`);
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to escalate alert into incident.');
    } finally {
      setActionInProgress(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
              <ShieldAlert className="size-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                Alert Center
              </h1>
              <p className="text-xs text-muted-foreground">
                Real-Time Operational Telemetry, Rule Evaluation & Incident Escalation
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <LiveStreamPill isConnected={isSseConnected} />

          {canRespond && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleEvaluate}
              disabled={evaluating}
              className="gap-2 border-border/70 text-xs"
            >
              {evaluating ? (
                <LoaderCircle className="size-3.5 animate-spin text-primary" />
              ) : (
                <Play className="size-3.5 text-primary" />
              )}
              Evaluate Rules
            </Button>
          )}

          <Link to="/alerts/rules">
            <Button variant="outline" size="sm" className="gap-2 border-border/70 text-xs">
              <Sliders className="size-3.5" />
              Rule Engine
            </Button>
          </Link>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => void loadData()}
            className="size-8 p-0"
            title="Refresh feed"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Evaluation notification banner */}
      {evalResult && (
        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-xs text-primary">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4" />
            <span>{evalResult}</span>
          </div>
          <button
            onClick={() => setEvalResult(null)}
            className="text-primary/70 hover:text-primary"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-xs text-destructive">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-destructive/70 hover:text-destructive">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricKpiCard
          title="Active Open"
          value={stats?.total_open ?? 0}
          subtext="Unresolved anomalies"
          icon={AlertCircle}
          variant={(stats?.total_open ?? 0) > 0 ? 'danger' : 'default'}
        />
        <MetricKpiCard
          title="Critical SEV1/2"
          value={stats?.total_critical ?? 0}
          subtext="High-impact failures"
          icon={ShieldAlert}
          variant={(stats?.total_critical ?? 0) > 0 ? 'warning' : 'default'}
        />
        <MetricKpiCard
          title="Snoozed"
          value={stats?.total_snoozed ?? 0}
          subtext="Temporarily silenced"
          icon={VolumeX}
          variant="info"
        />
        <MetricKpiCard
          title="Resolved"
          value={stats?.total_resolved ?? 0}
          subtext="Mitigated events"
          icon={CheckCircle2}
          variant="success"
        />
      </div>

      {/* Filter and Control Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/60 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {/* Search bar */}
          <div className="relative min-w-[200px] flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search alerts by title or description..."
              className="h-8 pl-8 text-xs bg-background/50 border-border/70"
            />
          </div>

          {/* Status selector */}
          <div className="flex rounded-lg border border-border/60 bg-muted/30 p-0.5">
            {(['all', 'open', 'acknowledged', 'snoozed', 'resolved'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                  statusFilter === st
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          {/* Severity selector */}
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as any)}
            className="h-8 rounded-lg border border-border/70 bg-background px-2.5 text-xs text-foreground font-mono"
          >
            <option value="all">All Severities</option>
            <option value="SEV1">SEV1 (Critical)</option>
            <option value="SEV2">SEV2 (Major)</option>
            <option value="SEV3">SEV3 (Minor)</option>
            <option value="SEV4">SEV4 (Info)</option>
          </select>

          {/* Service selector */}
          <select
            value={serviceFilter}
            onChange={(e) => setServiceFilter(e.target.value)}
            className="h-8 rounded-lg border border-border/70 bg-background px-2.5 text-xs text-foreground"
          >
            <option value="all">All Services</option>
            {services.map((svc) => (
              <option key={svc.id} value={svc.id}>
                {svc.name}
              </option>
            ))}
          </select>
        </div>

        {/* View Mode Switcher */}
        <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 p-0.5">
          <button
            onClick={() => setViewMode('flat')}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              viewMode === 'flat'
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <ListFilter className="size-3.5" />
            Feed
          </button>
          <button
            onClick={() => setViewMode('grouped')}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              viewMode === 'grouped'
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Layers className="size-3.5" />
            Grouped ({groups.length})
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground space-y-3">
          <LoaderCircle className="size-8 animate-spin text-primary" />
          <p className="text-xs">Streaming real-time operational alerts...</p>
        </div>
      ) : alerts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 bg-card/30 p-12 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted/50 text-muted-foreground">
            <CheckCircle2 className="size-6 text-emerald-400" />
          </div>
          <h3 className="mt-4 text-sm font-semibold text-foreground">
            No Operational Alerts Found
          </h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
            All services are healthy according to your configured alert rules. Any threshold breaches will appear here in real-time.
          </p>
          {canRespond && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleEvaluate}
              className="mt-4 gap-2 text-xs"
            >
              <Play className="size-3.5" />
              Evaluate Rules Now
            </Button>
          )}
        </div>
      ) : viewMode === 'flat' ? (
        /* Flat Alert Feed Table */
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card/40 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border/70 bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground font-mono">
                  <th className="px-4 py-3">Severity & Alert</th>
                  <th className="px-4 py-3">Service Scope</th>
                  <th className="px-4 py-3 text-center">Occurrences</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">First / Last Seen</th>
                  <th className="px-4 py-3">Incident Escalation</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {alerts.map((alert) => (
                  <tr
                    key={alert.id}
                    className="group transition-colors hover:bg-muted/30"
                  >
                    {/* Title & Severity */}
                    <td className="px-4 py-3.5 max-w-md">
                      <div className="flex items-start gap-2.5">
                        <div className="mt-0.5">
                          <AlertSeverityBadge severity={alert.severity} />
                        </div>
                        <div className="min-w-0">
                          <Link
                            to={`/alerts/${alert.id}`}
                            className="font-medium text-xs text-foreground group-hover:text-primary transition-colors underline-offset-4 hover:underline line-clamp-1"
                          >
                            {alert.title}
                          </Link>
                          {alert.description && (
                            <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                              {alert.description}
                            </p>
                          )}
                          {alert.rule_name && (
                            <span className="font-mono text-[10px] text-muted-foreground/80 mt-1 inline-block">
                              Rule: {alert.rule_name}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Target Service */}
                    <td className="px-4 py-3.5 text-xs text-muted-foreground">
                      {alert.service_name ? (
                        <span className="font-medium text-foreground">
                          {alert.service_name}
                        </span>
                      ) : (
                        <span className="italic text-muted-foreground/70">
                          Workspace-wide
                        </span>
                      )}
                    </td>

                    {/* Occurrences count */}
                    <td className="px-4 py-3.5 text-center">
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 font-mono text-[11px] font-semibold text-foreground border border-border/50">
                        {alert.occurrence_count}x
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3.5">
                      <AlertStatusBadge status={alert.status} />
                    </td>

                    {/* Timeline */}
                    <td className="px-4 py-3.5 text-xs text-muted-foreground">
                      <span className="block font-medium text-foreground">
                        {timeAgo(alert.last_seen_at)}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        Started {timeAgo(alert.first_seen_at)}
                      </span>
                    </td>

                    {/* Incident Escalation */}
                    <td className="px-4 py-3.5">
                      {alert.incident_id ? (
                        <div className="flex items-center gap-2">
                          <Link
                            to={`/incidents/${alert.incident_id}`}
                            className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition-colors"
                          >
                            <ShieldAlert className="size-3" />
                            {alert.incident_reference ?? 'Incident'}
                            <ExternalLink className="size-2.5 ml-0.5" />
                          </Link>
                          <Link
                            to={`/investigations`}
                            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                            title="AI Investigation"
                          >
                            <Sparkles className="size-3" />
                            AI
                          </Link>
                        </div>
                      ) : canRespond ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEscalateTarget(alert);
                            setEscalateTitle(alert.title);
                            setEscalateSeverity(alert.severity);
                          }}
                          className="h-7 gap-1 border border-dashed border-border/80 px-2 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/50"
                        >
                          <ShieldAlert className="size-3 text-rose-400" />
                          Escalate
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </td>

                    {/* Actions Menu */}
                    <td className="px-4 py-3.5 text-right">
                      {canRespond && (
                        <div className="flex items-center justify-end gap-1.5">
                          {alert.status === 'open' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleAcknowledge(alert.id)}
                              className="h-7 px-2 text-[11px] gap-1"
                              title="Acknowledge alert"
                            >
                              <Eye className="size-3" />
                              Ack
                            </Button>
                          )}

                          {alert.status !== 'resolved' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSnoozeAlertTarget(alert)}
                              className="h-7 px-2 text-[11px] gap-1 text-purple-400 hover:bg-purple-950/30"
                              title="Snooze alert"
                            >
                              <VolumeX className="size-3" />
                              Snooze
                            </Button>
                          )}

                          {alert.status !== 'resolved' ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setResolveAlertTarget(alert);
                                setResolveNote('');
                              }}
                              className="h-7 px-2 text-[11px] gap-1 border-emerald-500/30 text-emerald-400 hover:bg-emerald-950/30"
                              title="Resolve alert"
                            >
                              <CheckCircle2 className="size-3" />
                              Resolve
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleReopen(alert.id)}
                              className="h-7 px-2 text-[11px] gap-1 text-orange-400 hover:bg-orange-950/30"
                              title="Reopen alert"
                            >
                              <Volume2 className="size-3" />
                              Reopen
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Grouped View by Service */
        <div className="space-y-4">
          {groups.map((grp) => (
            <Card key={grp.group_key} className="overflow-hidden border-border/70 bg-card/40">
              <CardHeader className="p-4 border-b border-border/60 bg-muted/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 text-primary">
                      <Layers className="size-4" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-bold text-foreground">
                        {grp.service_name ?? 'Workspace Services'}
                      </CardTitle>
                      <p className="text-[11px] text-muted-foreground font-mono">
                        Key: {grp.group_key} • {grp.count} active alert(s)
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Latest: {timeAgo(grp.latest_seen_at)}
                    </span>
                    <AlertSeverityBadge severity={grp.highest_severity} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border/50">
                  {grp.alerts.map((al) => (
                    <div
                      key={al.id}
                      className="flex items-center justify-between p-3.5 hover:bg-muted/20 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <AlertSeverityBadge severity={al.severity} />
                        <div>
                          <Link
                            to={`/alerts/${al.id}`}
                            className="font-medium text-xs text-foreground hover:text-primary transition-colors underline-offset-4 hover:underline"
                          >
                            {al.title}
                          </Link>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {al.description}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="rounded-full bg-muted/60 px-2 py-0.5 font-mono text-[10px] text-foreground border border-border/40">
                          {al.occurrence_count}x
                        </span>
                        <AlertStatusBadge status={al.status} />
                        {al.incident_id && (
                          <Link
                            to={`/incidents/${al.incident_id}`}
                            className="inline-flex items-center gap-1 rounded bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 text-xs text-rose-300 font-semibold"
                          >
                            <ShieldAlert className="size-3" />
                            {al.incident_reference}
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Escalate to Incident Modal */}
      {escalateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-border/80 bg-card p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="size-5 text-rose-400" />
                <h3 className="font-semibold text-sm text-foreground">
                  Escalate Alert to Incident
                </h3>
              </div>
              <button
                onClick={() => setEscalateTarget(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              This creates an active operational incident in NEXUS, assigns tracking reference, and enables 1-click Agentic AI investigation.
            </p>

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
                onClick={() => setEscalateTarget(null)}
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
                Create Incident & Investigate
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Snooze Duration Modal */}
      {snoozeAlertTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-xl border border-border/80 bg-card p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <VolumeX className="size-5 text-purple-400" />
                <h3 className="font-semibold text-sm text-foreground">
                  Snooze Operational Alert
                </h3>
              </div>
              <button
                onClick={() => setSnoozeAlertTarget(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              Select snooze duration. If the condition continues to trigger after the snooze period elapses, the alert will automatically reopen.
            </p>

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSnooze(snoozeAlertTarget.id, 15)}
                disabled={actionInProgress}
                className="text-xs justify-start gap-2"
              >
                <Clock className="size-3.5" />
                15 Minutes
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSnooze(snoozeAlertTarget.id, 60)}
                disabled={actionInProgress}
                className="text-xs justify-start gap-2"
              >
                <Clock className="size-3.5" />
                1 Hour
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSnooze(snoozeAlertTarget.id, 240)}
                disabled={actionInProgress}
                className="text-xs justify-start gap-2"
              >
                <Clock className="size-3.5" />
                4 Hours
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSnooze(snoozeAlertTarget.id, 1440)}
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

      {/* Resolve Note Modal */}
      {resolveAlertTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-border/80 bg-card p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-emerald-400" />
                <h3 className="font-semibold text-sm text-foreground">
                  Resolve Alert
                </h3>
              </div>
              <button
                onClick={() => setResolveAlertTarget(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              Provide an optional resolution note describing what action mitigated this operational condition.
            </p>

            <div>
              <label className="text-xs font-medium text-foreground block mb-1">
                Resolution Note (Optional)
              </label>
              <textarea
                value={resolveNote}
                onChange={(e) => setResolveNote(e.target.value)}
                placeholder="e.g. Restarted database pool, scaled up checkout worker replicas, traffic normalized."
                rows={3}
                className="w-full rounded-lg border border-border/70 bg-background p-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 resize-none focus:outline-hidden focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setResolveAlertTarget(null)}
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
