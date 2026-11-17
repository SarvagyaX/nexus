import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Edit2,
  LoaderCircle,
  Plus,
  Power,
  RefreshCw,
  Server,
  Sliders,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useAuth } from '../auth/auth-context';
import { servicesApi } from '../services/api';
import type { Service } from '../services/types';
import { alertsApi } from './api';
import {
  AlertConditionBadge,
  AlertSeverityBadge,
} from './alert-ui';
import type {
  AlertRule,
  AlertRuleCondition,
  AlertSeverity,
} from './types';

export function AlertRulesPage() {
  const { activeWorkspaceId, workspaces, csrfToken } = useAuth();

  const role = workspaces.find((w) => w.id === activeWorkspaceId)?.role;
  const canManage = role === 'admin' || role === 'commander';

  const [rules, setRules] = useState<AlertRule[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog State
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Form Fields
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formServiceId, setFormServiceId] = useState<string>('all');
  const [formConditionType, setFormConditionType] = useState<AlertRuleCondition>('error_count');
  const [formThreshold, setFormThreshold] = useState<number>(5);
  const [formWindowMinutes, setFormWindowMinutes] = useState<number>(5);
  const [formCooldownMinutes, setFormCooldownMinutes] = useState<number>(15);
  const [formSeverity, setFormSeverity] = useState<AlertSeverity>('SEV2');
  const [formEnabled, setFormEnabled] = useState<boolean>(true);

  const loadData = async (silent = false) => {
    if (!activeWorkspaceId) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [rulesRes, servicesRes] = await Promise.all([
        alertsApi.getRules(activeWorkspaceId),
        servicesApi.list(activeWorkspaceId, { limit: 100 }).catch(() => ({ items: [] })),
      ]);
      setRules(rulesRes.items);
      setServices(servicesRes.items);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load alert rules.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [activeWorkspaceId]);

  const openCreateDialog = () => {
    setEditingRule(null);
    setFormName('');
    setFormDescription('');
    setFormServiceId('all');
    setFormConditionType('error_count');
    setFormThreshold(5);
    setFormWindowMinutes(5);
    setFormCooldownMinutes(15);
    setFormSeverity('SEV2');
    setFormEnabled(true);
    setDialogOpen(true);
  };

  const openEditDialog = (rule: AlertRule) => {
    setEditingRule(rule);
    setFormName(rule.name);
    setFormDescription(rule.description || '');
    setFormServiceId(rule.service_id || 'all');
    setFormConditionType(rule.condition_type);
    setFormThreshold(rule.threshold);
    setFormWindowMinutes(rule.window_minutes);
    setFormCooldownMinutes(rule.cooldown_minutes);
    setFormSeverity(rule.severity);
    setFormEnabled(rule.enabled);
    setDialogOpen(true);
  };

  const handleSaveRule = async () => {
    if (!activeWorkspaceId || !csrfToken) return;
    if (!formName.trim()) {
      setError('Rule name cannot be empty.');
      return;
    }

    setActionLoading(true);
    try {
      const targetServiceId = formServiceId === 'all' ? null : formServiceId;

      if (editingRule) {
        await alertsApi.patchRule(
          activeWorkspaceId,
          editingRule.id,
          {
            name: formName.trim(),
            description: formDescription.trim() || undefined,
            service_id: targetServiceId,
            condition_type: formConditionType,
            threshold: Number(formThreshold),
            window_minutes: Number(formWindowMinutes),
            cooldown_minutes: Number(formCooldownMinutes),
            severity: formSeverity,
            enabled: formEnabled,
          },
          csrfToken
        );
      } else {
        await alertsApi.createRule(
          activeWorkspaceId,
          {
            name: formName.trim(),
            description: formDescription.trim() || undefined,
            service_id: targetServiceId,
            condition_type: formConditionType,
            threshold: Number(formThreshold),
            window_minutes: Number(formWindowMinutes),
            cooldown_minutes: Number(formCooldownMinutes),
            severity: formSeverity,
            enabled: formEnabled,
          },
          csrfToken
        );
      }

      setDialogOpen(false);
      void loadData(true);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save alert rule.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleEnable = async (rule: AlertRule) => {
    if (!activeWorkspaceId || !csrfToken) return;
    try {
      await alertsApi.patchRule(
        activeWorkspaceId,
        rule.id,
        { enabled: !rule.enabled },
        csrfToken
      );
      void loadData(true);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update rule state.');
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!activeWorkspaceId || !csrfToken) return;
    if (!confirm('Are you sure you want to delete this alert rule?')) return;
    try {
      await alertsApi.deleteRule(activeWorkspaceId, ruleId, csrfToken);
      void loadData(true);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to delete alert rule.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Link
              to="/alerts"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="size-3.5" />
              Alert Center
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary">
              <Sliders className="size-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                Alert Rules Engine
              </h1>
              <p className="text-xs text-muted-foreground">
                Define automated conditions that inspect real-time log telemetry and generate operational alerts
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canManage && (
            <Button
              size="sm"
              onClick={openCreateDialog}
              className="gap-2 text-xs"
            >
              <Plus className="size-3.5" />
              New Rule
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => void loadData()}
            className="size-8 p-0"
            title="Refresh rules"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

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

      {/* Rules Table */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground space-y-3">
          <LoaderCircle className="size-8 animate-spin text-primary" />
          <p className="text-xs">Loading alert rules...</p>
        </div>
      ) : rules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 bg-card/30 p-12 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted/50 text-muted-foreground">
            <Sliders className="size-6 text-primary" />
          </div>
          <h3 className="mt-4 text-sm font-semibold text-foreground">
            No Alert Rules Configured
          </h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
            Configure rules to automatically monitor service error spikes, fatal crashes, and failure rate thresholds.
          </p>
          {canManage && (
            <Button
              size="sm"
              onClick={openCreateDialog}
              className="mt-4 gap-2 text-xs"
            >
              <Plus className="size-3.5" />
              Configure First Rule
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card/40 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border/70 bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground font-mono">
                  <th className="px-4 py-3">Rule Name & Details</th>
                  <th className="px-4 py-3">Condition & Threshold</th>
                  <th className="px-4 py-3">Service Scope</th>
                  <th className="px-4 py-3">Evaluation Window</th>
                  <th className="px-4 py-3">Cooldown</th>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {rules.map((rule) => (
                  <tr
                    key={rule.id}
                    className={`transition-colors hover:bg-muted/30 ${
                      !rule.enabled ? 'opacity-60 bg-muted/10' : ''
                    }`}
                  >
                    {/* Name & Desc */}
                    <td className="px-4 py-3.5 max-w-xs">
                      <div className="min-w-0">
                        <span className="font-semibold text-xs text-foreground block">
                          {rule.name}
                        </span>
                        {rule.description && (
                          <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                            {rule.description}
                          </p>
                        )}
                      </div>
                    </td>

                    {/* Condition */}
                    <td className="px-4 py-3.5">
                      <div className="space-y-1">
                        <AlertConditionBadge condition={rule.condition_type} />
                        <span className="block font-mono text-[11px] font-medium text-foreground">
                          ≥ {rule.threshold}{' '}
                          {rule.condition_type === 'error_rate' ? '%' : 'events'}
                        </span>
                      </div>
                    </td>

                    {/* Scope */}
                    <td className="px-4 py-3.5 text-xs text-muted-foreground">
                      {rule.service_name ? (
                        <span className="font-medium text-foreground inline-flex items-center gap-1">
                          <Server className="size-3 text-muted-foreground" />
                          {rule.service_name}
                        </span>
                      ) : (
                        <span className="italic text-muted-foreground/80">
                          Workspace-wide
                        </span>
                      )}
                    </td>

                    {/* Window */}
                    <td className="px-4 py-3.5 text-xs font-mono text-muted-foreground">
                      {rule.window_minutes}m
                    </td>

                    {/* Cooldown */}
                    <td className="px-4 py-3.5 text-xs font-mono text-muted-foreground">
                      {rule.cooldown_minutes}m
                    </td>

                    {/* Severity */}
                    <td className="px-4 py-3.5">
                      <AlertSeverityBadge severity={rule.severity} />
                    </td>

                    {/* Enabled toggle */}
                    <td className="px-4 py-3.5">
                      {canManage ? (
                        <button
                          onClick={() => handleToggleEnable(rule)}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors border ${
                            rule.enabled
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                              : 'border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted/60'
                          }`}
                        >
                          <Power className="size-3" />
                          {rule.enabled ? 'Enabled' : 'Disabled'}
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {rule.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3.5 text-right">
                      {canManage && (
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(rule)}
                            className="size-7 p-0 text-muted-foreground hover:text-foreground"
                            title="Edit rule"
                          >
                            <Edit2 className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteRule(rule.id)}
                            className="size-7 p-0 text-muted-foreground hover:text-destructive"
                            title="Delete rule"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create / Edit Rule Dialog */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-xl border border-border/80 bg-card p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="size-5 text-primary" />
                <h3 className="font-semibold text-sm text-foreground">
                  {editingRule ? 'Edit Alert Rule' : 'Create New Alert Rule'}
                </h3>
              </div>
              <button onClick={() => setDialogOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Name */}
              <div>
                <label className="font-medium text-foreground block mb-1">
                  Rule Name *
                </label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Critical 5xx Gateway Spike"
                  className="text-xs"
                />
              </div>

              {/* Description */}
              <div>
                <label className="font-medium text-foreground block mb-1">
                  Description
                </label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Operational context and expected behavior..."
                  rows={2}
                  className="w-full rounded-lg border border-border/70 bg-background p-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 resize-none focus:outline-hidden focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Scope & Severity */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-medium text-foreground block mb-1">
                    Service Scope
                  </label>
                  <select
                    value={formServiceId}
                    onChange={(e) => setFormServiceId(e.target.value)}
                    className="w-full h-9 rounded-lg border border-border/70 bg-background px-2.5 text-xs text-foreground"
                  >
                    <option value="all">Workspace-wide (All Services)</option>
                    {services.map((svc) => (
                      <option key={svc.id} value={svc.id}>
                        {svc.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-medium text-foreground block mb-1">
                    Alert Severity
                  </label>
                  <select
                    value={formSeverity}
                    onChange={(e) => setFormSeverity(e.target.value as AlertSeverity)}
                    className="w-full h-9 rounded-lg border border-border/70 bg-background px-2.5 text-xs text-foreground font-mono"
                  >
                    <option value="SEV1">SEV1 - Critical</option>
                    <option value="SEV2">SEV2 - Major</option>
                    <option value="SEV3">SEV3 - Minor</option>
                    <option value="SEV4">SEV4 - Info</option>
                  </select>
                </div>
              </div>

              {/* Condition Type */}
              <div>
                <label className="font-medium text-foreground block mb-1">
                  Condition Type
                </label>
                <select
                  value={formConditionType}
                  onChange={(e) => setFormConditionType(e.target.value as AlertRuleCondition)}
                  className="w-full h-9 rounded-lg border border-border/70 bg-background px-2.5 text-xs text-foreground"
                >
                  <option value="error_count">Error Count Threshold (e.g. ≥ 5 errors)</option>
                  <option value="fatal_log">Fatal Log Detection (Immediate crash alerts)</option>
                  <option value="error_rate">Error Rate Percentage (e.g. ≥ 10% errors)</option>
                  <option value="repeated_failures">Repeated Failures (Cluster of identical error prefixes)</option>
                </select>
              </div>

              {/* Threshold, Window, Cooldown */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-medium text-foreground block mb-1">
                    Threshold *
                  </label>
                  <Input
                    type="number"
                    min="1"
                    step="0.5"
                    value={formThreshold}
                    onChange={(e) => setFormThreshold(parseFloat(e.target.value) || 1)}
                    className="text-xs font-mono"
                  />
                  <span className="text-[10px] text-muted-foreground mt-0.5 block">
                    {formConditionType === 'error_rate' ? 'Percentage (%)' : 'Occurrence count'}
                  </span>
                </div>

                <div>
                  <label className="font-medium text-foreground block mb-1">
                    Window (min) *
                  </label>
                  <Input
                    type="number"
                    min="1"
                    max="1440"
                    value={formWindowMinutes}
                    onChange={(e) => setFormWindowMinutes(parseInt(e.target.value, 10) || 1)}
                    className="text-xs font-mono"
                  />
                  <span className="text-[10px] text-muted-foreground mt-0.5 block">
                    Telemetry lookback
                  </span>
                </div>

                <div>
                  <label className="font-medium text-foreground block mb-1">
                    Cooldown (min) *
                  </label>
                  <Input
                    type="number"
                    min="1"
                    max="1440"
                    value={formCooldownMinutes}
                    onChange={(e) => setFormCooldownMinutes(parseInt(e.target.value, 10) || 1)}
                    className="text-xs font-mono"
                  />
                  <span className="text-[10px] text-muted-foreground mt-0.5 block">
                    Silence repeat alerts
                  </span>
                </div>
              </div>

              {/* Enabled checkbox */}
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="ruleEnabled"
                  checked={formEnabled}
                  onChange={(e) => setFormEnabled(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary"
                />
                <label htmlFor="ruleEnabled" className="font-medium text-foreground cursor-pointer">
                  Enable rule immediately upon save
                </label>
              </div>
            </div>

            {/* Dialog Footer */}
            <div className="flex items-center justify-end gap-2 pt-4 border-t border-border/60">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDialogOpen(false)}
                disabled={actionLoading}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveRule}
                disabled={actionLoading}
                className="gap-2 text-xs"
              >
                {actionLoading && <LoaderCircle className="size-3.5 animate-spin" />}
                {editingRule ? 'Save Changes' : 'Create Rule'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
