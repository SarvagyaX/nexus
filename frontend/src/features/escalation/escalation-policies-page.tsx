import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Clock,
  Edit2,
  Globe,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  User,
  Users,
  Workflow,
} from 'lucide-react';
import { useAuth } from '../auth/auth-context';
import { escalationApi } from './api';
import { onCallApi } from '../on-call/api';
import type { OnCallSchedule } from '../on-call/types';
import type {
  EscalationExecution,
  EscalationPolicy,
  EscalationPolicyCreate,
  EscalationStep,
  EscalationTargetType,
} from './types';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';

export function EscalationPoliciesPage() {
  const { activeWorkspaceId, csrfToken } = useAuth();

  const [policies, setPolicies] = useState<EscalationPolicy[]>([]);
  const [executions, setExecutions] = useState<EscalationExecution[]>([]);
  const [schedules, setSchedules] = useState<OnCallSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingDue, setProcessingDue] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<EscalationPolicy | null>(null);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formMinSeverity, setFormMinSeverity] = useState('SEV2');
  const [formRepeatCount, setFormRepeatCount] = useState(0);
  const [formSteps, setFormSteps] = useState<EscalationStep[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const [polList, execList, schedList] = await Promise.all([
        escalationApi.listPolicies(activeWorkspaceId),
        escalationApi.listExecutions(activeWorkspaceId, undefined, 20),
        onCallApi.list(activeWorkspaceId),
      ]);
      setPolicies(polList);
      setExecutions(execList);
      setSchedules(schedList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load escalation policies.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleProcessDue = async () => {
    if (!activeWorkspaceId) return;
    setProcessingDue(true);
    try {
      await escalationApi.processDue(activeWorkspaceId, csrfToken ?? undefined);
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to process due escalations.');
    } finally {
      setProcessingDue(false);
    }
  };

  const openCreateModal = () => {
    setEditingPolicy(null);
    setFormName('');
    setFormDesc('');
    setFormMinSeverity('SEV2');
    setFormRepeatCount(1);
    setFormSteps([
      {
        step_number: 1,
        target_type: schedules.length > 0 ? 'schedule' : 'user',
        target_schedule_id: schedules[0]?.id ?? null,
        delay_minutes: 10,
      },
      {
        step_number: 2,
        target_type: 'webhook',
        target_webhook_url: 'https://example.com/pager-hook',
        delay_minutes: 20,
      },
    ]);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (policy: EscalationPolicy) => {
    setEditingPolicy(policy);
    setFormName(policy.name);
    setFormDesc(policy.description ?? '');
    setFormMinSeverity(policy.min_severity);
    setFormRepeatCount(policy.repeat_count);
    setFormSteps(
      policy.steps.length > 0
        ? policy.steps
        : [{ step_number: 1, target_type: 'user', delay_minutes: 15 }]
    );
    setFormError(null);
    setModalOpen(true);
  };

  const handleAddStep = () => {
    setFormSteps((prev) => [
      ...prev,
      {
        step_number: prev.length + 1,
        target_type: 'schedule',
        target_schedule_id: schedules[0]?.id ?? null,
        delay_minutes: 15,
      },
    ]);
  };

  const handleRemoveStep = (index: number) => {
    setFormSteps((prev) =>
      prev.filter((_, i) => i !== index).map((s, idx) => ({ ...s, step_number: idx + 1 }))
    );
  };

  const handleStepChange = (index: number, updates: Partial<EscalationStep>) => {
    setFormSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...updates } : s))
    );
  };

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkspaceId) return;
    if (!formName.trim()) {
      setFormError('Policy name is required.');
      return;
    }
    if (formSteps.length === 0) {
      setFormError('At least one escalation step is required.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const payload: EscalationPolicyCreate = {
        name: formName.trim(),
        description: formDesc.trim() || undefined,
        min_severity: formMinSeverity,
        repeat_count: formRepeatCount,
        steps: formSteps.map((s, idx) => ({ ...s, step_number: idx + 1 })),
      };

      if (editingPolicy) {
        await escalationApi.updatePolicy(
          activeWorkspaceId,
          editingPolicy.id,
          payload,
          csrfToken ?? undefined
        );
      } else {
        await escalationApi.createPolicy(activeWorkspaceId, payload, csrfToken ?? undefined);
      }
      setModalOpen(false);
      await loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save escalation policy.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePolicy = async (policyId: string) => {
    if (!activeWorkspaceId) return;
    if (!window.confirm('Are you sure you want to delete this escalation policy?')) return;
    try {
      await escalationApi.deletePolicy(activeWorkspaceId, policyId, csrfToken ?? undefined);
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete policy.');
    }
  };

  const getTargetLabel = (step: EscalationStep) => {
    if (step.target_type === 'schedule' || step.target_type === 'on_call_schedule') {
      const sched = schedules.find((s) => s.id === step.target_schedule_id);
      return sched ? `On-Call: ${sched.name}` : 'On-Call Schedule';
    }
    if (step.target_type === 'webhook') {
      return `Webhook: ${step.target_webhook_url ? step.target_webhook_url.replace(/^https?:\/\//, '').slice(0, 24) + '...' : 'Endpoint'}`;
    }
    return 'Assigned Responder / User';
  };

  const getTargetIcon = (type: EscalationTargetType) => {
    switch (type) {
      case 'schedule':
      case 'on_call_schedule':
        return <Users className="size-3.5 text-sky-400" />;
      case 'webhook':
        return <Globe className="size-3.5 text-purple-400" />;
      default:
        return <User className="size-3.5 text-emerald-400" />;
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-100">Escalation Policies</h1>
            <Badge variant="default">
              {policies.length} {policies.length === 1 ? 'Policy' : 'Policies'}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Multi-step automated notification policies that route critical incidents until acknowledged or resolved.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleProcessDue()}
            disabled={processingDue}
            className="gap-2 border-border/80 text-xs"
            title="Evaluate whether any active escalations have reached their next due step"
          >
            <Play className={`size-3 text-sky-400 ${processingDue ? 'animate-spin' : ''}`} />
            Evaluate Due Steps
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadData()}
            className="gap-2 border-border/80 text-xs"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={openCreateModal} className="gap-2 text-xs">
            <Plus className="size-3.5" />
            Create Policy
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-rose-500/30 bg-rose-500/[0.06] p-4 text-xs text-rose-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void loadData()} className="h-7 text-xs">
            Retry
          </Button>
        </Card>
      )}

      {/* Policies List */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
          <Workflow className="size-4 text-sky-400" />
          Active Paging Workflows
        </h2>

        {loading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="h-40 rounded-xl border border-border/40 bg-card/40 animate-pulse" />
            ))}
          </div>
        ) : policies.length === 0 ? (
          <Card className="p-12 text-center border-dashed border-border/80 bg-card/30">
            <div className="mx-auto grid size-12 place-items-center rounded-xl bg-slate-800/60 text-slate-400">
              <Workflow className="size-6 text-slate-500" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-slate-200">No escalation policies configured</h3>
            <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
              Create an escalation policy to ensure unacknowledged high-severity incidents automatically page the right responders.
            </p>
            <Button size="sm" onClick={openCreateModal} className="mt-4 gap-2 text-xs">
              <Plus className="size-3.5" />
              Create First Policy
            </Button>
          </Card>
        ) : (
          <div className="space-y-4">
            {policies.map((policy) => (
              <Card key={policy.id} className="p-6 border-border/70 bg-card/60 backdrop-blur space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-border/50 pb-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className="text-base font-bold text-slate-100">{policy.name}</h3>
                      <Badge
                        variant={policy.is_active ? 'success' : 'muted'}
                      >
                        {policy.is_active ? 'Active' : 'Disabled'}
                      </Badge>
                      <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30 text-[10px] uppercase font-bold">
                        Min: {policy.min_severity}
                      </Badge>
                      {policy.repeat_count > 0 && (
                        <span className="text-xs text-muted-foreground">
                          Repeats {policy.repeat_count}x
                        </span>
                      )}
                    </div>
                    {policy.description && (
                      <p className="mt-1 text-xs text-slate-300/80">{policy.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditModal(policy)}
                      className="h-8 gap-1.5 text-xs text-slate-300 hover:text-slate-100"
                    >
                      <Edit2 className="size-3" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleDeletePolicy(policy.id)}
                      className="h-8 gap-1.5 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                    >
                      <Trash2 className="size-3" />
                      Delete
                    </Button>
                  </div>
                </div>

                {/* Step Visualizer Ladder */}
                <div className="space-y-2">
                  <span className="text-[11px] font-semibold tracking-wider uppercase text-slate-400">
                    Escalation Step Sequence
                  </span>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {policy.steps.map((step, idx) => (
                      <React.Fragment key={idx}>
                        <div className="flex items-center gap-2 p-2.5 rounded-lg border border-border/60 bg-background/50 text-xs">
                          <span className="grid size-5 place-items-center rounded bg-slate-800 text-[10px] font-mono font-bold text-sky-400">
                            {step.step_number}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {getTargetIcon(step.target_type)}
                            <span className="font-medium text-slate-200">{getTargetLabel(step)}</span>
                          </div>
                          {step.delay_minutes > 0 && (
                            <span className="text-[10px] text-muted-foreground font-mono bg-slate-800 px-1.5 py-0.5 rounded">
                              wait {step.delay_minutes}m
                            </span>
                          )}
                        </div>
                        {idx < policy.steps.length - 1 && (
                          <ArrowRight className="size-3.5 text-slate-600 shrink-0" />
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Recent Executions Monitor */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Activity className="size-4 text-emerald-400" />
            Live Escalation Executions
          </h2>
          <span className="text-xs text-muted-foreground">Showing recent 20 runs</span>
        </div>

        {executions.length === 0 ? (
          <Card className="p-8 text-center border-dashed border-border/80 bg-card/30">
            <p className="text-xs text-muted-foreground">
              No escalation executions recorded yet. Escalations trigger automatically when alerts or incidents are created.
            </p>
          </Card>
        ) : (
          <Card className="border-border/70 bg-card/60 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/60 border-b border-border text-slate-400 text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 font-semibold">Entity</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Current Step</th>
                  <th className="px-4 py-3 font-semibold">Started</th>
                  <th className="px-4 py-3 font-semibold">Next Escalation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {executions.map((ex) => (
                  <tr key={ex.id} className="hover:bg-accent/[0.03]">
                    <td className="px-4 py-3 font-medium text-slate-200">
                      {ex.incident_id ? (
                        <span className="font-mono text-sky-400">Incident {ex.incident_id.slice(0, 8)}</span>
                      ) : ex.alert_id ? (
                        <span className="font-mono text-rose-400">Alert {ex.alert_id.slice(0, 8)}</span>
                      ) : (
                        'Execution'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          ex.status === 'active'
                            ? 'default'
                            : ex.status === 'acknowledged'
                              ? 'success'
                              : ex.status === 'resolved'
                                ? 'muted'
                                : 'warning'
                        }
                      >
                        {ex.status.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-300">
                      Step {ex.current_step_number} ({ex.history.length} logged)
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(ex.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {ex.next_escalation_at ? (
                        <span className="text-amber-400 flex items-center gap-1 font-mono">
                          <Clock className="size-3" />
                          {new Date(ex.next_escalation_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      ) : (
                        '--'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      {/* Create / Edit Policy Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-popover p-6 shadow-2xl space-y-5">
            <div>
              <h2 className="text-lg font-bold text-slate-100">
                {editingPolicy ? 'Edit Escalation Policy' : 'Create Escalation Policy'}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Define the sequence of targets to page if an incident remains unacknowledged.
              </p>
            </div>

            {formError && (
              <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/[0.08] text-xs text-rose-300 flex items-center gap-2">
                <AlertTriangle className="size-4 shrink-0 text-rose-400" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSavePolicy} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-300">Policy Name *</label>
                <Input
                  required
                  placeholder="e.g. Critical Outage Escalation"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-300">Description</label>
                <Input
                  placeholder="e.g. Escalates SEV1 and SEV2 incidents"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300">Minimum Severity</label>
                  <select
                    value={formMinSeverity}
                    onChange={(e) => setFormMinSeverity(e.target.value)}
                    className="w-full h-9 rounded-md border border-border bg-slate-900 px-3 text-xs text-slate-200"
                  >
                    <option value="SEV1">SEV1 (Critical Outages only)</option>
                    <option value="SEV2">SEV2 (High Severity and above)</option>
                    <option value="SEV3">SEV3 (Medium Severity and above)</option>
                    <option value="SEV4">SEV4 (All severities)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300">Repeat Count</label>
                  <Input
                    type="number"
                    min={0}
                    max={5}
                    value={formRepeatCount}
                    onChange={(e) => setFormRepeatCount(parseInt(e.target.value, 10) || 0)}
                    className="text-xs"
                  />
                </div>
              </div>

              {/* Step Sequence Builder */}
              <div className="space-y-3 pt-2 border-t border-border/50">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-200">Escalation Steps</label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleAddStep}
                    className="h-7 text-xs text-sky-400 hover:text-sky-300"
                  >
                    <Plus className="size-3" /> Add Step
                  </Button>
                </div>

                <div className="space-y-3">
                  {formSteps.map((step, idx) => (
                    <div key={idx} className="p-3 rounded-lg border border-border/50 bg-slate-900/40 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                          <span className="grid size-5 place-items-center rounded bg-slate-800 text-[10px] font-mono text-sky-400">
                            {idx + 1}
                          </span>
                          Step {idx + 1}
                        </span>
                        {formSteps.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleRemoveStep(idx)}
                            className="text-slate-500 hover:text-rose-400"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <label className="text-[10px] text-muted-foreground uppercase">Target Type</label>
                          <select
                            value={step.target_type}
                            onChange={(e) =>
                              handleStepChange(idx, { target_type: e.target.value as EscalationTargetType })
                            }
                            className="w-full h-8 rounded-md border border-border bg-slate-900 px-2 text-xs text-slate-200"
                          >
                            <option value="schedule">On-Call Schedule</option>
                            <option value="user">Assigned Responder</option>
                            <option value="webhook">Outbound Webhook</option>
                          </select>
                        </div>

                        <div className="space-y-1 sm:col-span-2">
                          <label className="text-[10px] text-muted-foreground uppercase">Target Config</label>
                          {step.target_type === 'schedule' || step.target_type === 'on_call_schedule' ? (
                            <select
                              value={step.target_schedule_id ?? ''}
                              onChange={(e) => handleStepChange(idx, { target_schedule_id: e.target.value || null })}
                              className="w-full h-8 rounded-md border border-border bg-slate-900 px-2 text-xs text-slate-200"
                            >
                              {schedules.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                              {schedules.length === 0 && <option value="">No schedules configured</option>}
                            </select>
                          ) : step.target_type === 'webhook' ? (
                            <Input
                              placeholder="https://pager.domain.com/hook"
                              value={step.target_webhook_url ?? ''}
                              onChange={(e) => handleStepChange(idx, { target_webhook_url: e.target.value })}
                              className="text-xs h-8"
                            />
                          ) : (
                            <div className="h-8 flex items-center px-2 text-xs text-muted-foreground bg-slate-800/40 rounded border border-border/40">
                              Pages active incident assignee or commander
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <label className="text-xs text-slate-400">Delay before next escalation:</label>
                        <Input
                          type="number"
                          min={1}
                          max={1440}
                          value={step.delay_minutes}
                          onChange={(e) =>
                            handleStepChange(idx, { delay_minutes: parseInt(e.target.value, 10) || 5 })
                          }
                          className="w-20 text-xs h-7"
                        />
                        <span className="text-xs text-muted-foreground">minutes</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-border/50">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setModalOpen(false)}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={saving} className="text-xs">
                  {saving ? 'Saving...' : editingPolicy ? 'Save Changes' : 'Create Policy'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
