import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  RotateCw,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  FileCode,
  AlertTriangle,
  Ban,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { useAuth } from '../auth/auth-context';
import { playbooksApi } from './api';
import type { PlaybookExecution } from './types';

interface PlaybookExecutionDetailPageProps {
  workspaceId?: string;
  csrfToken?: string;
}

export function PlaybookExecutionDetailPage({ workspaceId: propWsId, csrfToken: propCsrf }: PlaybookExecutionDetailPageProps) {
  const { executionId } = useParams<{ executionId: string }>();
  const navigate = useNavigate();
  const { activeWorkspaceId, csrfToken: authCsrf } = useAuth();
  const workspaceId = propWsId || activeWorkspaceId || '';
  const csrfToken = propCsrf || authCsrf;

  const [execution, setExecution] = useState<PlaybookExecution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Approval state
  const [approvalComment, setApprovalComment] = useState('');
  const [acting, setActing] = useState(false);

  // Expanded payloads for inspection
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});

  const toggleExpand = (stepId: string) => {
    setExpandedSteps((prev) => ({ ...prev, [stepId]: !prev[stepId] }));
  };

  const fetchExecution = async () => {
    if (!workspaceId || !executionId) return;
    try {
      setLoading(true);
      setError(null);
      const data = await playbooksApi.getExecution(workspaceId, executionId);
      setExecution(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load execution details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExecution();
  }, [workspaceId, executionId]);

  const handleApprove = async () => {
    if (!executionId) return;
    try {
      setActing(true);
      setError(null);
      const updated = await playbooksApi.approveStep(
        workspaceId,
        executionId,
        approvalComment || undefined,
        csrfToken
      );
      setExecution(updated);
      setSuccessMsg('Step approved. Playbook execution resumed.');
    } catch (err: any) {
      setError(err?.message || 'Failed to approve step');
    } finally {
      setActing(false);
    }
  };

  const handleReject = async () => {
    if (!executionId) return;
    try {
      setActing(true);
      setError(null);
      const updated = await playbooksApi.rejectStep(
        workspaceId,
        executionId,
        approvalComment || undefined,
        csrfToken
      );
      setExecution(updated);
      setSuccessMsg('Step rejected. Playbook execution terminated.');
    } catch (err: any) {
      setError(err?.message || 'Failed to reject step');
    } finally {
      setActing(false);
    }
  };

  const handleCancel = async () => {
    if (!executionId) return;
    try {
      setActing(true);
      setError(null);
      const updated = await playbooksApi.cancelExecution(workspaceId, executionId, csrfToken);
      setExecution(updated);
      setSuccessMsg('Playbook execution cancelled.');
    } catch (err: any) {
      setError(err?.message || 'Failed to cancel execution');
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RotateCw className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!execution) {
    return (
      <Card className="p-8 text-center border-dashed">
        <p className="text-muted-foreground">Execution not found.</p>
        <Button variant="secondary" size="sm" onClick={() => navigate('/playbooks')} className="mt-4">
          Back to Playbooks
        </Button>
      </Card>
    );
  }

  const statusVariant =
    execution.status === 'completed'
      ? 'success'
      : execution.status === 'running'
      ? 'violet'
      : execution.status === 'awaiting_approval'
      ? 'warning'
      : execution.status === 'failed'
      ? 'danger'
      : 'muted';

  const canCancel =
    execution.status === 'pending' ||
    execution.status === 'running' ||
    execution.status === 'awaiting_approval';

  return (
    <div className="space-y-6 max-w-4xl pb-12">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => navigate(`/playbooks/${execution.playbook_id}`)}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white">
                Execution: {execution.playbook_name || 'Playbook'}
              </h1>
              <Badge variant={statusVariant}>{execution.status.toUpperCase()}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              ID: <span className="font-mono text-white">{execution.id}</span> • Triggered by{' '}
              <span className="font-medium text-white">{execution.trigger_type.replace('_', ' ')}</span>
              {execution.duration_ms && ` • Completed in ${execution.duration_ms}ms`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={fetchExecution} title="Refresh">
            <RotateCw className="size-3.5" />
          </Button>
          {canCancel && (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleCancel}
              disabled={acting}
              className="h-8 text-xs gap-1"
            >
              <Ban className="size-3.5" />
              Cancel Execution
            </Button>
          )}
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

      {/* Prominent Approval Banner */}
      {execution.status === 'awaiting_approval' && execution.pending_approval && (
        <Card className="border-amber-500/40 bg-amber-950/20 p-5 shadow-lg">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-amber-500/20 p-2 text-amber-400">
              <ShieldAlert className="size-6" />
            </div>
            <div className="space-y-2 flex-1">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-amber-300 uppercase tracking-wide">
                  Human Approval Required
                </h3>
                <Badge variant="warning">AWAITING AUTHORIZATION</Badge>
              </div>

              <p className="text-sm text-white font-medium">
                {execution.pending_approval.prompt}
              </p>
              <p className="text-xs text-muted-foreground">
                This playbook step halted execution and requires an authorized team member's approval to proceed.
              </p>

              <div className="pt-2">
                <label className="text-[11px] font-medium text-muted-foreground">
                  Approver Comment (Optional)
                </label>
                <Input
                  value={approvalComment}
                  onChange={(e) => setApprovalComment(e.target.value)}
                  placeholder="e.g. Verified with Commander on bridge..."
                  className="mt-1 text-xs"
                />
              </div>

              <div className="flex items-center gap-3 pt-3">
                <Button
                  onClick={handleApprove}
                  disabled={acting}
                  className="bg-emerald-600 text-white hover:bg-emerald-700 h-9 text-xs font-semibold gap-1.5"
                >
                  <CheckCircle2 className="size-4" />
                  {acting ? 'Processing...' : 'Approve Step & Resume'}
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleReject}
                  disabled={acting}
                  className="h-9 text-xs font-semibold gap-1.5"
                >
                  <XCircle className="size-4" />
                  {acting ? 'Processing...' : 'Reject & Terminate'}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Target Resource Bindings */}
      {(execution.incident_id || execution.alert_id) && (
        <Card className="border-border bg-card p-4 text-xs">
          <span className="font-semibold text-white">Target Operational Entities: </span>
          {execution.incident_id && (
            <Link
              to={`/incidents/${execution.incident_id}`}
              className="ml-2 inline-flex items-center gap-1 text-primary hover:underline"
            >
              Incident ({execution.incident_id.slice(0, 8)})
            </Link>
          )}
          {execution.alert_id && (
            <Link
              to={`/alerts/${execution.alert_id}`}
              className="ml-2 inline-flex items-center gap-1 text-primary hover:underline"
            >
              Alert ({execution.alert_id.slice(0, 8)})
            </Link>
          )}
        </Card>
      )}

      {/* Step Executions Timeline */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-white">Step Execution Timeline</h3>

        <div className="space-y-3">
          {execution.step_executions.map((se) => {
            const isExpanded = !!expandedSteps[se.id];
            const stepVariant =
              se.status === 'completed'
                ? 'success'
                : se.status === 'running'
                ? 'violet'
                : se.status === 'awaiting_approval'
                ? 'warning'
                : se.status === 'failed'
                ? 'danger'
                : 'muted';

            const StepStatusIcon =
              se.status === 'completed'
                ? CheckCircle2
                : se.status === 'running'
                ? RotateCw
                : se.status === 'awaiting_approval'
                ? ShieldAlert
                : se.status === 'failed'
                ? AlertCircle
                : Clock;

            return (
              <Card
                key={se.id}
                className="border-border bg-card/80 p-4 transition-all hover:border-primary/30"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-6 items-center justify-center rounded-full bg-secondary text-xs font-bold text-white">
                      {se.step_order}
                    </span>
                    <StepStatusIcon
                      className={`size-4 ${
                        se.status === 'completed'
                          ? 'text-emerald-400'
                          : se.status === 'running'
                          ? 'animate-spin text-violet-400'
                          : se.status === 'awaiting_approval'
                          ? 'text-amber-400'
                          : se.status === 'failed'
                          ? 'text-rose-400'
                          : 'text-muted-foreground'
                      }`}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">{se.step_name}</span>
                        <Badge variant="violet" className="text-[10px]">
                          {se.action_type.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                        {se.duration_ms !== null && <span>{se.duration_ms}ms</span>}
                        {se.completed_at && <span>• Finished {new Date(se.completed_at).toLocaleTimeString()}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge variant={stepVariant}>{se.status.toUpperCase()}</Badge>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => toggleExpand(se.id)}
                      title={isExpanded ? 'Collapse Payloads' : 'Inspect Payloads'}
                    >
                      {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    </Button>
                  </div>
                </div>

                {/* Error Banner */}
                {se.error_message && (
                  <div className="mt-3 rounded border border-rose-500/20 bg-rose-500/10 p-2 text-xs text-rose-300">
                    <span className="font-semibold">Error: </span>
                    {se.error_message}
                  </div>
                )}

                {/* Collapsible Inspection Panel */}
                {isExpanded && (
                  <div className="mt-4 space-y-3 border-t border-border/50 pt-3 text-xs">
                    <div>
                      <div className="flex items-center gap-1.5 text-muted-foreground font-semibold mb-1">
                        <FileCode className="size-3.5" />
                        <span>Input Configuration</span>
                      </div>
                      <pre className="rounded bg-black/40 p-2.5 font-mono text-[11px] text-slate-300 overflow-x-auto border border-border/40">
                        {JSON.stringify(se.input_payload, null, 2)}
                      </pre>
                    </div>

                    <div>
                      <div className="flex items-center gap-1.5 text-muted-foreground font-semibold mb-1">
                        <CheckCircle2 className="size-3.5" />
                        <span>Output / Telemetry Result</span>
                      </div>
                      <pre className="rounded bg-black/40 p-2.5 font-mono text-[11px] text-emerald-300 overflow-x-auto border border-border/40">
                        {JSON.stringify(se.output_payload, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
