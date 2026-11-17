import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Play,
  Copy,
  Archive,
  Save,
  Clock,
  RotateCw,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { useAuth } from '../auth/auth-context';
import { playbooksApi } from './api';
import type {
  Playbook,
  PlaybookActionType,
  PlaybookExecution,
  PlaybookStepCreate,
  PlaybookTriggerType,
} from './types';

interface PlaybookDetailPageProps {
  workspaceId?: string;
  csrfToken?: string;
}

export function PlaybookDetailPage({ workspaceId: propWsId, csrfToken: propCsrf }: PlaybookDetailPageProps) {
  const { playbookId } = useParams<{ playbookId: string }>();
  const navigate = useNavigate();
  const { activeWorkspaceId, csrfToken: authCsrf } = useAuth();
  const workspaceId = propWsId || activeWorkspaceId || '';
  const csrfToken = propCsrf || authCsrf;

  const [playbook, setPlaybook] = useState<Playbook | null>(null);
  const [executions, setExecutions] = useState<PlaybookExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'steps' | 'history' | 'settings'>('steps');

  // Editable state
  const [editableSteps, setEditableSteps] = useState<PlaybookStepCreate[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<Playbook['status']>('draft');
  const [triggerType, setTriggerType] = useState<PlaybookTriggerType>('manual');
  const [severities, setSeverities] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Run modal
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [runIncidentId, setRunIncidentId] = useState('');
  const [runningAction, setRunningAction] = useState(false);

  const loadData = async () => {
    if (!workspaceId || !playbookId) return;
    try {
      setLoading(true);
      setError(null);
      const [pb, execs] = await Promise.all([
        playbooksApi.getPlaybook(workspaceId, playbookId),
        playbooksApi.listExecutions(workspaceId, { playbook_id: playbookId, limit: 20 }),
      ]);
      setPlaybook(pb);
      setExecutions(execs.items);

      setName(pb.name);
      setDescription(pb.description || '');
      setStatus(pb.status);
      setTriggerType(pb.trigger_type);
      setSeverities(pb.severity_applicability || []);
      setEditableSteps(
        (pb.steps || []).map((s) => ({
          name: s.name,
          action_type: s.action_type,
          action_config: dictCopy(s.action_config),
          step_order: s.step_order,
          is_enabled: s.is_enabled,
          continue_on_failure: s.continue_on_failure,
          timeout_seconds: s.timeout_seconds,
        }))
      );
    } catch (err: any) {
      setError(err?.message || 'Failed to load playbook');
    } finally {
      setLoading(false);
    }
  };

  const dictCopy = (obj: any) => {
    try {
      return JSON.parse(JSON.stringify(obj || {}));
    } catch {
      return {};
    }
  };

  useEffect(() => {
    loadData();
  }, [workspaceId, playbookId]);

  const handleSaveChanges = async () => {
    if (!playbookId) return;
    try {
      setSaving(true);
      setError(null);
      const updated = await playbooksApi.updatePlaybook(
        workspaceId,
        playbookId,
        {
          name,
          description,
          status,
          trigger_type: triggerType,
          severity_applicability: severities,
          steps: editableSteps,
        },
        csrfToken
      );
      setPlaybook(updated);
      setSuccessMsg('Playbook changes saved successfully.');
    } catch (err: any) {
      setError(err?.message || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async () => {
    if (!playbookId) return;
    try {
      setSaving(true);
      const dup = await playbooksApi.duplicatePlaybook(workspaceId, playbookId, csrfToken);
      navigate(`/playbooks/${dup.id}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to duplicate playbook');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!playbookId) return;
    try {
      setSaving(true);
      await playbooksApi.archivePlaybook(workspaceId, playbookId, csrfToken);
      setStatus('archived');
      setSuccessMsg('Playbook archived.');
    } catch (err: any) {
      setError(err?.message || 'Failed to archive playbook');
    } finally {
      setSaving(false);
    }
  };

  const handleExecute = async () => {
    if (!playbookId) return;
    try {
      setRunningAction(true);
      const execution = await playbooksApi.executePlaybook(
        workspaceId,
        playbookId,
        { incident_id: runIncidentId || undefined },
        csrfToken
      );
      setRunModalOpen(false);
      navigate(`/playbook-executions/${execution.id}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to execute playbook');
    } finally {
      setRunningAction(false);
    }
  };

  const addStep = () => {
    const nextOrder = editableSteps.length + 1;
    const newStep: PlaybookStepCreate = {
      name: `Step ${nextOrder}: New Action`,
      action_type: 'create_incident_note',
      action_config: { body: 'Automated note.' },
      step_order: nextOrder,
      is_enabled: true,
      continue_on_failure: false,
      timeout_seconds: 60,
    };
    setEditableSteps([...editableSteps, newStep]);
  };

  const moveStep = (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= editableSteps.length) return;
    const reordered = [...editableSteps];
    const temp = reordered[index];
    reordered[index] = reordered[targetIdx];
    reordered[targetIdx] = temp;
    setEditableSteps(reordered.map((s, idx) => ({ ...s, step_order: idx + 1 })));
  };

  const removeStep = (index: number) => {
    const updated = editableSteps
      .filter((_, i) => i !== index)
      .map((s, idx) => ({ ...s, step_order: idx + 1 }));
    setEditableSteps(updated);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RotateCw className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!playbook) {
    return (
      <Card className="p-8 text-center border-dashed">
        <p className="text-muted-foreground">Playbook not found.</p>
        <Button variant="secondary" size="sm" onClick={() => navigate('/playbooks')} className="mt-4">
          Back to Playbooks
        </Button>
      </Card>
    );
  }

  const statusVariant =
    playbook.status === 'active'
      ? 'success'
      : playbook.status === 'draft'
      ? 'warning'
      : playbook.status === 'archived'
      ? 'danger'
      : 'muted';

  return (
    <div className="space-y-6 max-w-5xl pb-12">
      {/* Top Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => navigate('/playbooks')}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-white">{playbook.name}</h1>
              <Badge variant={statusVariant}>{playbook.status.toUpperCase()}</Badge>
              <Badge variant="violet">{playbook.trigger_type.replace('_', ' ')}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Version {playbook.version} • {playbook.execution_count} total runs
              {playbook.last_executed_at && ` • Last executed ${new Date(playbook.last_executed_at).toLocaleString()}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="default"
            onClick={() => setRunModalOpen(true)}
            className="h-8 gap-1.5 text-xs"
          >
            <Play className="size-3 fill-current" />
            Run Playbook
          </Button>
          <Button size="sm" variant="secondary" onClick={handleDuplicate} disabled={saving} className="h-8 text-xs gap-1">
            <Copy className="size-3" />
            Duplicate
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleArchive}
            disabled={saving || playbook.status === 'archived'}
            className="h-8 text-xs gap-1"
          >
            <Archive className="size-3" />
            Archive
          </Button>
          <Button
            size="sm"
            onClick={handleSaveChanges}
            disabled={saving}
            className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700"
          >
            <Save className="size-3.5" />
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {successMsg && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-xs text-muted-foreground hover:text-white">
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-xs text-muted-foreground hover:text-white">
            Dismiss
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-border text-xs font-medium">
        <button
          onClick={() => setActiveTab('steps')}
          className={`border-b-2 px-4 py-2 transition-colors ${
            activeTab === 'steps' ? 'border-primary text-white font-semibold' : 'border-transparent text-muted-foreground hover:text-white'
          }`}
        >
          Workflow Steps ({editableSteps.length})
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`border-b-2 px-4 py-2 transition-colors ${
            activeTab === 'history' ? 'border-primary text-white font-semibold' : 'border-transparent text-muted-foreground hover:text-white'
          }`}
        >
          Execution History ({executions.length})
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`border-b-2 px-4 py-2 transition-colors ${
            activeTab === 'settings' ? 'border-primary text-white font-semibold' : 'border-transparent text-muted-foreground hover:text-white'
          }`}
        >
          Settings & Triggers
        </button>
      </div>

      {/* Tab: Workflow Steps */}
      {activeTab === 'steps' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Configure and reorder sequential action steps executed when this playbook triggers.
            </p>
            <Button size="sm" variant="secondary" onClick={addStep} className="h-8 text-xs gap-1">
              <Plus className="size-3.5" />
              Add Step
            </Button>
          </div>

          <div className="space-y-3">
            {editableSteps.map((step, idx) => (
              <Card key={idx} className="border-border bg-card p-4">
                <div className="flex items-center justify-between gap-3 border-b border-border/40 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {idx + 1}
                    </span>
                    <Input
                      value={step.name}
                      onChange={(e) => {
                        const updated = [...editableSteps];
                        updated[idx].name = e.target.value;
                        setEditableSteps(updated);
                      }}
                      className="h-8 font-medium text-xs w-64"
                    />
                    <Badge variant="violet" className="text-[11px]">
                      {step.action_type.replace(/_/g, ' ')}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => moveStep(idx, 'up')}
                      disabled={idx === 0}
                      title="Move Up"
                    >
                      <ArrowUp className="size-3" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => moveStep(idx, 'down')}
                      disabled={idx === editableSteps.length - 1}
                      title="Move Down"
                    >
                      <ArrowDown className="size-3" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => removeStep(idx)}
                      disabled={editableSteps.length <= 1}
                      title="Delete Step"
                      className="text-rose-400 hover:text-rose-300"
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>

                {/* Parameters configuration */}
                <div className="grid gap-3 pt-3 sm:grid-cols-2 text-xs">
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground">Action Type</label>
                    <select
                      value={step.action_type}
                      onChange={(e) => {
                        const updated = [...editableSteps];
                        updated[idx].action_type = e.target.value as PlaybookActionType;
                        setEditableSteps(updated);
                      }}
                      aria-label="Action type"
                      className="mt-1 w-full rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="create_incident_note">Create Incident Note</option>
                      <option value="assign_incident">Assign Incident</option>
                      <option value="change_incident_severity">Change Severity</option>
                      <option value="send_notification">Send Notification</option>
                      <option value="trigger_investigation">Trigger AI Investigation</option>
                      <option value="send_webhook">Send Outbound Webhook</option>
                      <option value="wait_duration">Wait Duration</option>
                      <option value="require_approval">Require Approval</option>
                    </select>
                  </div>

                  <div>
                    {step.action_type === 'create_incident_note' && (
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground">Note Body</label>
                        <Input
                          value={step.action_config?.body || ''}
                          onChange={(e) => {
                            const updated = [...editableSteps];
                            updated[idx].action_config = { ...updated[idx].action_config, body: e.target.value };
                            setEditableSteps(updated);
                          }}
                          className="mt-1 h-8 text-xs"
                        />
                      </div>
                    )}

                    {step.action_type === 'change_incident_severity' && (
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground">Target Severity</label>
                        <select
                          value={step.action_config?.severity || 'SEV1'}
                          onChange={(e) => {
                            const updated = [...editableSteps];
                            updated[idx].action_config = { ...updated[idx].action_config, severity: e.target.value };
                            setEditableSteps(updated);
                          }}
                          aria-label="Target severity"
                          className="mt-1 w-full rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs text-foreground"
                        >
                          <option value="SEV1">SEV1 (Critical)</option>
                          <option value="SEV2">SEV2 (Major)</option>
                          <option value="SEV3">SEV3 (Moderate)</option>
                          <option value="SEV4">SEV4 (Minor)</option>
                        </select>
                      </div>
                    )}

                    {step.action_type === 'require_approval' && (
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground">Approval Prompt</label>
                        <Input
                          value={step.action_config?.prompt || ''}
                          onChange={(e) => {
                            const updated = [...editableSteps];
                            updated[idx].action_config = { ...updated[idx].action_config, prompt: e.target.value };
                            setEditableSteps(updated);
                          }}
                          className="mt-1 h-8 text-xs"
                        />
                      </div>
                    )}

                    {step.action_type === 'wait_duration' && (
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground">Seconds</label>
                        <Input
                          type="number"
                          value={step.action_config?.duration_seconds || 5}
                          onChange={(e) => {
                            const updated = [...editableSteps];
                            updated[idx].action_config = {
                              ...updated[idx].action_config,
                              duration_seconds: parseInt(e.target.value) || 5,
                            };
                            setEditableSteps(updated);
                          }}
                          className="mt-1 h-8 text-xs"
                        />
                      </div>
                    )}

                    {step.action_type === 'send_webhook' && (
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground">Webhook URL</label>
                        <Input
                          value={step.action_config?.webhook_url || ''}
                          onChange={(e) => {
                            const updated = [...editableSteps];
                            updated[idx].action_config = {
                              ...updated[idx].action_config,
                              webhook_url: e.target.value,
                            };
                            setEditableSteps(updated);
                          }}
                          className="mt-1 h-8 text-xs"
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-border/30 pt-2 text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground hover:text-white">
                    <input
                      type="checkbox"
                      checked={step.continue_on_failure}
                      onChange={(e) => {
                        const updated = [...editableSteps];
                        updated[idx].continue_on_failure = e.target.checked;
                        setEditableSteps(updated);
                      }}
                      className="rounded border-border text-primary focus:ring-0"
                    />
                    <span>Continue on failure</span>
                  </label>
                  <Badge variant={step.continue_on_failure ? 'warning' : 'muted'} className="text-[10px]">
                    {step.continue_on_failure ? 'Non-blocking' : 'Strict Failure'}
                  </Badge>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Execution History */}
      {activeTab === 'history' && (
        <div className="space-y-3">
          {executions.length === 0 ? (
            <Card className="p-8 text-center border-dashed">
              <Clock className="size-8 text-muted-foreground mx-auto mb-2 opacity-50" />
              <p className="text-sm font-medium text-white">No executions yet</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Execute this playbook manually or trigger it via operational events to see run history.
              </p>
              <Button size="sm" onClick={() => setRunModalOpen(true)} className="mt-3">
                Run Now
              </Button>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-secondary/50 font-semibold text-muted-foreground">
                  <tr>
                    <th className="p-3">Execution ID</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Trigger</th>
                    <th className="p-3">Duration</th>
                    <th className="p-3">Started At</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {executions.map((ex) => {
                    const stVariant =
                      ex.status === 'completed'
                        ? 'success'
                        : ex.status === 'running'
                        ? 'violet'
                        : ex.status === 'awaiting_approval'
                        ? 'warning'
                        : ex.status === 'failed'
                        ? 'danger'
                        : 'muted';

                    return (
                      <tr key={ex.id} className="hover:bg-secondary/20 transition-colors">
                        <td className="p-3 font-mono text-[11px] text-white">
                          <Link
                            to={`/playbook-executions/${ex.id}`}
                            className="text-primary hover:underline"
                          >
                            {ex.id.slice(0, 8)}...
                          </Link>
                        </td>
                        <td className="p-3">
                          <Badge variant={stVariant}>{ex.status.toUpperCase()}</Badge>
                        </td>
                        <td className="p-3 text-muted-foreground">{ex.trigger_type.replace('_', ' ')}</td>
                        <td className="p-3 text-muted-foreground">{ex.duration_ms ? `${ex.duration_ms}ms` : '—'}</td>
                        <td className="p-3 text-muted-foreground">
                          {ex.started_at ? new Date(ex.started_at).toLocaleString() : '—'}
                        </td>
                        <td className="p-3 text-right">
                          <Link
                            to={`/playbook-executions/${ex.id}`}
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            View
                            <ExternalLink className="size-3" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Settings & Triggers */}
      {activeTab === 'settings' && (
        <Card className="space-y-4 border-border bg-card p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Playbook Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Lifecycle Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                aria-label="Lifecycle status"
                className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 pt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Trigger Type</label>
              <select
                value={triggerType}
                onChange={(e) => setTriggerType(e.target.value as PlaybookTriggerType)}
                aria-label="Trigger type"
                className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="manual">Manual Execution Only</option>
                <option value="alert_created">Alert Created</option>
                <option value="incident_created">Incident Created</option>
                <option value="incident_severity_changed">Incident Severity Changed</option>
                <option value="incident_assigned">Incident Assigned</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Severities Applicable</label>
              <div className="mt-1.5 flex gap-2">
                {['SEV1', 'SEV2', 'SEV3', 'SEV4'].map((sev) => {
                  const isSelected = severities.includes(sev);
                  return (
                    <button
                      key={sev}
                      type="button"
                      onClick={() =>
                        setSeverities((prev) =>
                          prev.includes(sev) ? prev.filter((s) => s !== sev) : [...prev, sev]
                        )
                      }
                      className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                        isSelected
                          ? 'border border-primary bg-primary/20 text-primary'
                          : 'border border-border bg-secondary/50 text-muted-foreground hover:bg-secondary'
                      }`}
                    >
                      {sev}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Manual Run Modal */}
      {runModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Execute Playbook</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Trigger an execution run for <span className="text-white font-medium">{playbook.name}</span>.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Target Incident ID (Optional)</label>
                <Input
                  placeholder="UUID of target incident..."
                  value={runIncidentId}
                  onChange={(e) => setRunIncidentId(e.target.value)}
                  className="mt-1 text-xs"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRunModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleExecute}
                disabled={runningAction}
                className="gap-1.5"
              >
                <Play className="size-3 fill-current" />
                {runningAction ? 'Executing...' : 'Start Execution'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
