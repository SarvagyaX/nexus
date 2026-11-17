import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Sparkles,
  AlertCircle,
  Clock,
  Send,
  MessageSquare,
  UserCheck,
  Brain,
  ShieldAlert,
  Webhook,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { useAuth } from '../auth/auth-context';
import { playbooksApi } from './api';
import type {
  PlaybookActionType,
  PlaybookStepCreate,
  PlaybookTemplate,
  PlaybookTriggerType,
} from './types';

interface PlaybookCreatePageProps {
  workspaceId?: string;
  csrfToken?: string;
}

const ACTION_TYPES: { type: PlaybookActionType; label: string; icon: any; desc: string }[] = [
  { type: 'create_incident_note', label: 'Create Incident Note', icon: MessageSquare, desc: 'Posts an append-only timeline note to the incident' },
  { type: 'assign_incident', label: 'Assign Incident', icon: UserCheck, desc: 'Assigns the incident to a specific user' },
  { type: 'change_incident_severity', label: 'Change Severity', icon: ShieldAlert, desc: 'Updates the operational severity (SEV1-SEV4)' },
  { type: 'send_notification', label: 'Send Notification', icon: Send, desc: 'Dispatches in-app / multi-channel notification' },
  { type: 'trigger_investigation', label: 'Trigger AI Investigation', icon: Brain, desc: 'Launches Agentic AI Investigation on incident' },
  { type: 'send_webhook', label: 'Send Outbound Webhook', icon: Webhook, desc: 'Delivers an HTTP POST payload to external URL' },
  { type: 'wait_duration', label: 'Wait Duration', icon: Clock, desc: 'Pauses execution for a specified duration' },
  { type: 'require_approval', label: 'Require Approval', icon: AlertCircle, desc: 'Halts workflow until a human responder approves' },
];

export function PlaybookCreatePage({ workspaceId: propWsId, csrfToken: propCsrf }: PlaybookCreatePageProps) {
  const navigate = useNavigate();
  const { activeWorkspaceId, csrfToken: authCsrf } = useAuth();
  const workspaceId = propWsId || activeWorkspaceId || '';
  const csrfToken = propCsrf || authCsrf;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('incident_response');
  const [triggerType, setTriggerType] = useState<PlaybookTriggerType>('incident_created');
  const [severities, setSeverities] = useState<string[]>(['SEV1', 'SEV2']);

  const [steps, setSteps] = useState<PlaybookStepCreate[]>([
    {
      name: 'Initial Triage Note',
      action_type: 'create_incident_note',
      action_config: { body: 'Playbook response initiated.' },
      step_order: 1,
      is_enabled: true,
      continue_on_failure: false,
      timeout_seconds: 60,
    },
  ]);

  const [templates, setTemplates] = useState<PlaybookTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (workspaceId) {
      playbooksApi.getTemplates(workspaceId).then(setTemplates).catch(() => {});
    }
  }, [workspaceId]);

  const toggleSeverity = (sev: string) => {
    setSeverities((prev) =>
      prev.includes(sev) ? prev.filter((s) => s !== sev) : [...prev, sev]
    );
  };

  const addStep = (actionType: PlaybookActionType = 'create_incident_note') => {
    const nextOrder = steps.length + 1;
    let initialConfig: Record<string, any> = {};

    if (actionType === 'create_incident_note') initialConfig = { body: 'Automated note.' };
    else if (actionType === 'change_incident_severity') initialConfig = { severity: 'SEV1' };
    else if (actionType === 'send_notification') initialConfig = { title: 'Playbook Notification', message: 'Update', severity: 'warning' };
    else if (actionType === 'wait_duration') initialConfig = { duration_seconds: 5 };
    else if (actionType === 'require_approval') initialConfig = { prompt: 'Verify and approve automated action.' };
    else if (actionType === 'send_webhook') initialConfig = { webhook_url: 'https://httpbin.org/post' };

    const newStep: PlaybookStepCreate = {
      name: `Step ${nextOrder}: ${actionType.replace(/_/g, ' ')}`,
      action_type: actionType,
      action_config: initialConfig,
      step_order: nextOrder,
      is_enabled: true,
      continue_on_failure: false,
      timeout_seconds: 60,
    };
    setSteps([...steps, newStep]);
  };

  const removeStep = (index: number) => {
    const updated = steps.filter((_, i) => i !== index).map((s, idx) => ({ ...s, step_order: idx + 1 }));
    setSteps(updated);
  };

  const moveStep = (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= steps.length) return;
    const reordered = [...steps];
    const temp = reordered[index];
    reordered[index] = reordered[targetIdx];
    reordered[targetIdx] = temp;
    setSteps(reordered.map((s, idx) => ({ ...s, step_order: idx + 1 })));
  };

  const updateStepConfig = (index: number, key: string, value: any) => {
    setSteps((prev) =>
      prev.map((s, i) => {
        if (i !== index) return s;
        return {
          ...s,
          action_config: { ...s.action_config, [key]: value },
        };
      })
    );
  };

  const updateStepMeta = (index: number, key: keyof PlaybookStepCreate, value: any) => {
    setSteps((prev) =>
      prev.map((s, i) => {
        if (i !== index) return s;
        return { ...s, [key]: value };
      })
    );
  };

  const handleApplyTemplate = (tpl: PlaybookTemplate) => {
    setName(tpl.name);
    setDescription(tpl.description);
    setCategory(tpl.category);
    setTriggerType(tpl.trigger_type);
    setSeverities(tpl.severity_applicability || []);
    setSteps(tpl.steps);
  };

  const handleSave = async (activate: boolean) => {
    if (!name.trim()) {
      setError('Playbook name is required.');
      return;
    }
    if (steps.length === 0) {
      setError('At least one step is required.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const created = await playbooksApi.createPlaybook(
        workspaceId,
        {
          name,
          description: description || undefined,
          category,
          status: activate ? 'active' : 'draft',
          trigger_type: triggerType,
          trigger_config: { severities },
          severity_applicability: severities,
          steps,
        },
        csrfToken
      );
      navigate(`/playbooks/${created.id}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to create playbook');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl pb-12">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => navigate('/playbooks')}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">New Playbook</h1>
            <p className="text-xs text-muted-foreground">
              Define operational trigger conditions and ordered automation steps.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => handleSave(false)} disabled={loading}>
            Save as Draft
          </Button>
          <Button onClick={() => handleSave(true)} disabled={loading} className="bg-primary text-primary-foreground hover:bg-primary/90">
            Create & Activate
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Quick Template Picker */}
      {templates.length > 0 && (
        <Card className="border-violet-500/30 bg-violet-950/15 p-4">
          <div className="flex items-center gap-2 text-violet-300 text-xs font-semibold mb-2">
            <Sparkles className="size-4" />
            <span>Or Start with a Pre-configured Template</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {templates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => handleApplyTemplate(tpl)}
                className="rounded-lg border border-border/80 bg-card/60 p-2 text-left text-xs transition-colors hover:border-violet-400/60 hover:bg-violet-900/20"
              >
                <div className="font-medium text-white truncate">{tpl.name}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{tpl.steps.length} steps</div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* General Settings */}
      <Card className="space-y-4 border-border bg-card p-5">
        <h3 className="text-sm font-semibold text-white border-b border-border pb-2">1. Playbook Details</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Playbook Name *</label>
            <Input
              placeholder="e.g. Database Outage Automatic Failover"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Playbook category"
              className="mt-1 w-full rounded-md border border-border bg-secondary px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="incident_response">Incident Response</option>
              <option value="alert_remediation">Alert Remediation</option>
              <option value="investigation">Investigation</option>
              <option value="maintenance">Maintenance</option>
              <option value="general">General</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Description</label>
          <textarea
            rows={2}
            placeholder="Operational purpose, target systems, and runbook instructions..."
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
              aria-label="Playbook trigger type"
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
            <label className="text-xs font-medium text-muted-foreground">Applicable Severities</label>
            <div className="mt-1.5 flex gap-2">
              {['SEV1', 'SEV2', 'SEV3', 'SEV4'].map((sev) => {
                const isSelected = severities.includes(sev);
                return (
                  <button
                    key={sev}
                    type="button"
                    onClick={() => toggleSeverity(sev)}
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

      {/* Visual Step Builder */}
      <Card className="space-y-4 border-border bg-card p-5">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <div>
            <h3 className="text-sm font-semibold text-white">2. Sequential Workflow Steps</h3>
            <p className="text-xs text-muted-foreground">
              Steps are executed sequentially from top to bottom.
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => addStep()} className="h-8 text-xs gap-1">
            <Plus className="size-3.5" />
            Add Step
          </Button>
        </div>

        <div className="space-y-3">
          {steps.map((step, idx) => {
            const actMeta = ACTION_TYPES.find((a) => a.type === step.action_type);
            const StepIcon = actMeta?.icon || MessageSquare;

            return (
              <div
                key={idx}
                className="rounded-lg border border-border/80 bg-secondary/20 p-4 transition-all hover:border-primary/30"
              >
                {/* Step Header */}
                <div className="flex items-center justify-between gap-3 border-b border-border/40 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {idx + 1}
                    </span>
                    <StepIcon className="size-4 text-violet-400" />
                    <Input
                      value={step.name}
                      onChange={(e) => updateStepMeta(idx, 'name', e.target.value)}
                      className="h-8 font-medium text-xs w-64"
                    />
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
                      disabled={idx === steps.length - 1}
                      title="Move Down"
                    >
                      <ArrowDown className="size-3" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => removeStep(idx)}
                      disabled={steps.length <= 1}
                      title="Delete Step"
                      className="text-rose-400 hover:text-rose-300"
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>

                {/* Step Action Config */}
                <div className="grid gap-3 pt-3 sm:grid-cols-2">
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground">Action Type</label>
                    <select
                      value={step.action_type}
                      onChange={(e) => updateStepMeta(idx, 'action_type', e.target.value as PlaybookActionType)}
                      aria-label="Action type"
                      className="mt-1 w-full rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {ACTION_TYPES.map((a) => (
                        <option key={a.type} value={a.type}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-muted-foreground mt-1">{actMeta?.desc}</p>
                  </div>

                  {/* Parameter Fields based on Action Type */}
                  <div>
                    {step.action_type === 'create_incident_note' && (
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground">Note Body</label>
                        <Input
                          value={step.action_config?.body || ''}
                          onChange={(e) => updateStepConfig(idx, 'body', e.target.value)}
                          placeholder="Note text to append..."
                          className="mt-1 h-8 text-xs"
                        />
                      </div>
                    )}

                    {step.action_type === 'change_incident_severity' && (
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground">Target Severity</label>
                        <select
                          value={step.action_config?.severity || 'SEV1'}
                          onChange={(e) => updateStepConfig(idx, 'severity', e.target.value)}
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

                    {step.action_type === 'send_notification' && (
                      <div className="space-y-2">
                        <div>
                          <label className="text-[11px] font-medium text-muted-foreground">Notification Title</label>
                          <Input
                            value={step.action_config?.title || ''}
                            onChange={(e) => updateStepConfig(idx, 'title', e.target.value)}
                            placeholder="Title..."
                            className="mt-1 h-8 text-xs"
                          />
                        </div>
                      </div>
                    )}

                    {step.action_type === 'require_approval' && (
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground">Approval Prompt</label>
                        <Input
                          value={step.action_config?.prompt || ''}
                          onChange={(e) => updateStepConfig(idx, 'prompt', e.target.value)}
                          placeholder="e.g. Commander sign-off required for failover..."
                          className="mt-1 h-8 text-xs"
                        />
                      </div>
                    )}

                    {step.action_type === 'wait_duration' && (
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground">Duration (Seconds)</label>
                        <Input
                          type="number"
                          min="1"
                          max="300"
                          value={step.action_config?.duration_seconds || 5}
                          onChange={(e) => updateStepConfig(idx, 'duration_seconds', parseInt(e.target.value) || 5)}
                          className="mt-1 h-8 text-xs"
                        />
                      </div>
                    )}

                    {step.action_type === 'send_webhook' && (
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground">Webhook Destination URL</label>
                        <Input
                          value={step.action_config?.webhook_url || ''}
                          onChange={(e) => updateStepConfig(idx, 'webhook_url', e.target.value)}
                          placeholder="https://..."
                          className="mt-1 h-8 text-xs"
                        />
                      </div>
                    )}

                    {step.action_type === 'trigger_investigation' && (
                      <div className="rounded-md border border-violet-500/20 bg-violet-500/10 p-2.5 text-xs text-violet-300">
                        Launches the NEXUS LangGraph autonomous investigation workflow against the incident.
                      </div>
                    )}

                    {step.action_type === 'assign_incident' && (
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground">Assignee User ID</label>
                        <Input
                          value={step.action_config?.assignee_user_id || ''}
                          onChange={(e) => updateStepConfig(idx, 'assignee_user_id', e.target.value)}
                          placeholder="User UUID..."
                          className="mt-1 h-8 text-xs"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Step Options Footer */}
                <div className="mt-3 flex items-center justify-between border-t border-border/30 pt-2 text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground hover:text-white">
                    <input
                      type="checkbox"
                      checked={step.continue_on_failure}
                      onChange={(e) => updateStepMeta(idx, 'continue_on_failure', e.target.checked)}
                      className="rounded border-border text-primary focus:ring-0"
                    />
                    <span>Continue workflow even if this step fails</span>
                  </label>

                  <Badge variant={step.continue_on_failure ? 'warning' : 'muted'} className="text-[10px]">
                    {step.continue_on_failure ? 'Non-blocking' : 'Strict Failure'}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>

        <div className="pt-2">
          <Button variant="secondary" size="sm" onClick={() => addStep()} className="w-full border-dashed py-4 text-xs gap-1.5">
            <Plus className="size-4" />
            Append New Step
          </Button>
        </div>
      </Card>
    </div>
  );
}
