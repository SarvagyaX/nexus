import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bell,
  Brain,
  CheckCircle2,
  Globe,
  Mail,
  Save,
  Send,
  Server,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import { useAuth } from '../auth/auth-context';
import { notificationsApi } from './api';
import type {
  NotificationPreference,
  NotificationPreferenceUpdate,
  ProviderStatus,
  TestWebhookResponse,
} from './types';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';

const SEVERITY_OPTIONS = [
  { label: 'SEV1 (Critical Outages only)', value: 'SEV1' },
  { label: 'SEV2 (High Severity and above)', value: 'SEV2' },
  { label: 'SEV3 (Medium Severity and above)', value: 'SEV3' },
  { label: 'SEV4 (All Events including Low)', value: 'SEV4' },
];

export function NotificationPreferencesPage() {
  const { activeWorkspaceId, csrfToken } = useAuth();

  const [prefs, setPrefs] = useState<NotificationPreference | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Webhook Test state
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookResult, setWebhookResult] = useState<TestWebhookResponse | null>(null);

  useEffect(() => {
    async function loadData() {
      if (!activeWorkspaceId) return;
      setLoading(true);
      try {
        const [prefData, provData] = await Promise.all([
          notificationsApi.getPreferences(activeWorkspaceId),
          notificationsApi.getProvidersStatus(activeWorkspaceId),
        ]);
        setPrefs(prefData);
        setProviders(provData.providers);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Failed to load preferences.');
      } finally {
        setLoading(false);
      }
    }
    void loadData();
  }, [activeWorkspaceId]);

  const handleToggle = (field: keyof NotificationPreferenceUpdate) => {
    if (!prefs) return;
    setPrefs({ ...prefs, [field]: !prefs[field as keyof NotificationPreference] });
    setSaveSuccess(false);
  };

  const handleSelectSeverity = (
    field: 'alerts_min_severity' | 'incidents_min_severity',
    value: string
  ) => {
    if (!prefs) return;
    setPrefs({ ...prefs, [field]: value });
    setSaveSuccess(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkspaceId || !prefs) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const payload: NotificationPreferenceUpdate = {
        alerts_enabled: prefs.alerts_enabled,
        alerts_min_severity: prefs.alerts_min_severity,
        incidents_enabled: prefs.incidents_enabled,
        incidents_min_severity: prefs.incidents_min_severity,
        investigations_enabled: prefs.investigations_enabled,
        assignments_enabled: prefs.assignments_enabled,
        in_app_enabled: prefs.in_app_enabled,
        email_enabled: prefs.email_enabled,
        webhook_enabled: prefs.webhook_enabled,
        webhook_url: prefs.webhook_url,
      };
      const updated = await notificationsApi.updatePreferences(
        activeWorkspaceId,
        payload,
        csrfToken ?? undefined
      );
      setPrefs(updated);
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save preferences.');
    } finally {
      setSaving(false);
    }
  };

  const handleTestWebhook = async () => {
    if (!activeWorkspaceId || !prefs?.webhook_url) return;
    setTestingWebhook(true);
    setWebhookResult(null);

    try {
      const res = await notificationsApi.testWebhook(
        activeWorkspaceId,
        prefs.webhook_url,
        csrfToken ?? undefined
      );
      setWebhookResult(res);
    } catch (err) {
      setWebhookResult({
        success: false,
        message: err instanceof Error ? err.message : 'Webhook dispatch error.',
        duration_ms: 0,
      });
    } finally {
      setTestingWebhook(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 max-w-4xl mx-auto py-6">
        <div className="h-8 w-48 rounded bg-card/60 animate-pulse" />
        <div className="h-40 rounded-xl bg-card/40 animate-pulse" />
        <div className="h-60 rounded-xl bg-card/40 animate-pulse" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-8 max-w-4xl mx-auto pb-12">
      {/* Top Navigation & Title */}
      <div>
        <Link to="/notifications" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-slate-200 mb-2">
          <ArrowLeft className="size-3.5" />
          Back to Notification Center
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-100">Notification Preferences</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Customize delivery channels, alert thresholds, and operational event subscriptions.
            </p>
          </div>
          <Button type="submit" disabled={saving} className="gap-2 text-xs">
            <Save className="size-3.5" />
            {saving ? 'Saving...' : 'Save Preferences'}
          </Button>
        </div>
      </div>

      {saveSuccess && (
        <Card className="border-emerald-500/30 bg-emerald-500/[0.06] p-4 text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
          <span>Notification preferences saved successfully.</span>
        </Card>
      )}

      {saveError && (
        <Card className="border-rose-500/30 bg-rose-500/[0.06] p-4 text-xs text-rose-300 flex items-center gap-2">
          <AlertTriangle className="size-4 text-rose-400 shrink-0" />
          <span>{saveError}</span>
        </Card>
      )}

      {/* Delivery Channels */}
      <Card className="p-6 border-border/70 bg-card/60 space-y-6">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Globe className="size-4 text-sky-400" />
            Delivery Channels
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Select how you want notifications routed to you and external systems.
          </p>
        </div>

        <div className="divide-y divide-border/50">
          {/* In-App */}
          <div className="py-4 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Bell className="size-4 text-slate-300" />
                <span className="text-sm font-medium text-slate-200">In-App Notification Center</span>
                <Badge variant="success" className="text-[10px]">
                  Recommended
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Displays updates in the top navigation bell dropdown and dedicated notifications page.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={prefs?.in_app_enabled ?? true}
                onChange={() => handleToggle('in_app_enabled')}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-500" />
            </label>
          </div>

          {/* Email */}
          <div className="py-4 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Mail className="size-4 text-slate-300" />
                <span className="text-sm font-medium text-slate-200">Email Notifications</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Delivers email digests for high-priority incidents and critical escalations.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={prefs?.email_enabled ?? false}
                onChange={() => handleToggle('email_enabled')}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-500" />
            </label>
          </div>

          {/* Outbound Webhook */}
          <div className="py-4 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Server className="size-4 text-slate-300" />
                  <span className="text-sm font-medium text-slate-200">Outbound Webhook Dispatch</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  POSTs JSON payloads to your custom monitoring endpoint or third-party ticketing gateway.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs?.webhook_enabled ?? false}
                  onChange={() => handleToggle('webhook_enabled')}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-500" />
              </label>
            </div>

            {prefs?.webhook_enabled && (
              <div className="space-y-3 pl-6 border-l-2 border-border/60">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Webhook Target Endpoint (HTTPS)</label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="url"
                      placeholder="https://api.yourdomain.com/nexus-webhook"
                      value={prefs.webhook_url ?? ''}
                      onChange={(e) => setPrefs({ ...prefs, webhook_url: e.target.value })}
                      className="text-xs font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleTestWebhook()}
                      disabled={testingWebhook || !prefs.webhook_url}
                      className="gap-1.5 text-xs shrink-0"
                    >
                      <Send className="size-3" />
                      {testingWebhook ? 'Testing...' : 'Test Webhook'}
                    </Button>
                  </div>
                </div>

                {webhookResult && (
                  <Card
                    className={`p-3 text-xs flex items-center justify-between ${
                      webhookResult.success
                        ? 'border-emerald-500/30 bg-emerald-500/[0.04] text-emerald-300'
                        : 'border-rose-500/30 bg-rose-500/[0.04] text-rose-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {webhookResult.success ? (
                        <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                      ) : (
                        <AlertTriangle className="size-4 text-rose-400 shrink-0" />
                      )}
                      <span>
                        {webhookResult.message}{' '}
                        {webhookResult.status_code && `(HTTP ${webhookResult.status_code})`}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {webhookResult.duration_ms}ms
                    </span>
                  </Card>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Event Subscriptions & Thresholds */}
      <Card className="p-6 border-border/70 bg-card/60 space-y-6">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Activity className="size-4 text-amber-400" />
            Event Subscriptions & Severity Filters
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Control which events generate notifications and set minimum severity thresholds to prevent noise.
          </p>
        </div>

        <div className="space-y-6">
          {/* Alerts Filter */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-3.5 rounded-lg border border-border/50 bg-background/50">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <ShieldAlert className="size-4 text-rose-400" />
                <span className="text-sm font-medium text-slate-200">Alert Rule Notifications</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Triggered when log aggregations or system metrics breach configured alerting thresholds.
              </p>
            </div>
            <div className="flex items-center gap-3 self-end sm:self-auto">
              <select
                value={prefs?.alerts_min_severity ?? 'SEV3'}
                onChange={(e) => handleSelectSeverity('alerts_min_severity', e.target.value)}
                disabled={!prefs?.alerts_enabled}
                className="h-8 rounded-md border border-border bg-slate-900 px-2.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                {SEVERITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    Min: {opt.label}
                  </option>
                ))}
              </select>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs?.alerts_enabled ?? true}
                  onChange={() => handleToggle('alerts_enabled')}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-500" />
              </label>
            </div>
          </div>

          {/* Incidents Filter */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-3.5 rounded-lg border border-border/50 bg-background/50">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Activity className="size-4 text-amber-400" />
                <span className="text-sm font-medium text-slate-200">Incident Lifecycle Events</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Triggered on incident creation, status progression, acknowledgement, and resolution.
              </p>
            </div>
            <div className="flex items-center gap-3 self-end sm:self-auto">
              <select
                value={prefs?.incidents_min_severity ?? 'SEV3'}
                onChange={(e) => handleSelectSeverity('incidents_min_severity', e.target.value)}
                disabled={!prefs?.incidents_enabled}
                className="h-8 rounded-md border border-border bg-slate-900 px-2.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                {SEVERITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    Min: {opt.label}
                  </option>
                ))}
              </select>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs?.incidents_enabled ?? true}
                  onChange={() => handleToggle('incidents_enabled')}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-500" />
              </label>
            </div>
          </div>

          {/* Investigations Filter */}
          <div className="flex items-center justify-between gap-4 p-3.5 rounded-lg border border-border/50 bg-background/50">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Brain className="size-4 text-sky-400" />
                <span className="text-sm font-medium text-slate-200">AI Investigation Completions</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Receive notifications when autonomous AI investigations discover root causes or remediation steps.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={prefs?.investigations_enabled ?? true}
                onChange={() => handleToggle('investigations_enabled')}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-500" />
            </label>
          </div>

          {/* Assignments */}
          <div className="flex items-center justify-between gap-4 p-3.5 rounded-lg border border-border/50 bg-background/50">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <UserCheck className="size-4 text-emerald-400" />
                <span className="text-sm font-medium text-slate-200">Direct Assignments & On-Call Shifts</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Notify when you are assigned as incident commander or become the active on-call responder.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={prefs?.assignments_enabled ?? true}
                onChange={() => handleToggle('assignments_enabled')}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-500" />
            </label>
          </div>
        </div>
      </Card>

      {/* Provider Operational Status */}
      <Card className="p-6 border-border/70 bg-card/60 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Delivery Provider Health</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Current operational status of notification dispatch transports.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {providers.map((p) => (
            <div key={p.channel} className="p-3 rounded-lg border border-border/40 bg-background/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">{p.name}</span>
                <Badge
                  variant={p.is_available ? 'success' : 'muted'}
                  className="text-[10px]"
                >
                  {p.is_available ? 'Available' : 'Disabled'}
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">{p.description}</p>
            </div>
          ))}
        </div>
      </Card>
    </form>
  );
}
