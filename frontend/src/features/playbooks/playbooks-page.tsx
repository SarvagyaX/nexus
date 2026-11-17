import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play,
  Plus,
  Copy,
  Archive,
  Trash2,
  Search,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  RotateCw,
  Clock,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { useAuth } from '../auth/auth-context';
import { playbooksApi } from './api';
import type { Playbook, PlaybookStatus, PlaybookTemplate } from './types';

interface PlaybooksPageProps {
  workspaceId?: string;
  csrfToken?: string;
}

export function PlaybooksPage({ workspaceId: propWsId, csrfToken: propCsrf }: PlaybooksPageProps) {
  const navigate = useNavigate();
  const { activeWorkspaceId, csrfToken: authCsrf } = useAuth();
  const workspaceId = propWsId || activeWorkspaceId || '';
  const csrfToken = propCsrf || authCsrf;

  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [templates, setTemplates] = useState<PlaybookTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<'all' | PlaybookStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Modals
  const [templatesModalOpen, setTemplatesModalOpen] = useState(false);
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [selectedPlaybookForRun, setSelectedPlaybookForRun] = useState<Playbook | null>(null);
  const [runIncidentId, setRunIncidentId] = useState('');
  const [runningAction, setRunningAction] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const fetchPlaybooks = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await playbooksApi.listPlaybooks(workspaceId, {
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: searchQuery || undefined,
        category: selectedCategory === 'all' ? undefined : selectedCategory,
      });
      setPlaybooks(res.items);
    } catch (err: any) {
      setError(err?.message || 'Failed to load playbooks');
    } finally {
      setLoading(false);
    }
  };

  const fetchTemplates = async () => {
    try {
      const data = await playbooksApi.getTemplates(workspaceId);
      setTemplates(data);
    } catch {
      // ignore template fetch errors silently
    }
  };

  useEffect(() => {
    if (workspaceId) {
      fetchPlaybooks();
      fetchTemplates();
    }
  }, [workspaceId, statusFilter, selectedCategory]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    playbooks.forEach((p) => {
      if (p.category) cats.add(p.category);
    });
    return Array.from(cats);
  }, [playbooks]);

  const handleDuplicate = async (playbookId: string) => {
    try {
      setRunningAction(true);
      await playbooksApi.duplicatePlaybook(workspaceId, playbookId, csrfToken);
      setActionSuccess('Playbook duplicated successfully as draft.');
      await fetchPlaybooks();
    } catch (err: any) {
      setError(err?.message || 'Failed to duplicate playbook');
    } finally {
      setRunningAction(false);
    }
  };

  const handleArchive = async (playbookId: string) => {
    try {
      setRunningAction(true);
      await playbooksApi.archivePlaybook(workspaceId, playbookId, csrfToken);
      setActionSuccess('Playbook archived.');
      await fetchPlaybooks();
    } catch (err: any) {
      setError(err?.message || 'Failed to archive playbook');
    } finally {
      setRunningAction(false);
    }
  };

  const handleDelete = async (playbookId: string, name: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete '${name}'?`)) return;
    try {
      setRunningAction(true);
      await playbooksApi.deletePlaybook(workspaceId, playbookId, csrfToken);
      setActionSuccess('Playbook deleted.');
      await fetchPlaybooks();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete playbook');
    } finally {
      setRunningAction(false);
    }
  };

  const handleInstantiateTemplate = async (templateId: string) => {
    try {
      setRunningAction(true);
      const newPb = await playbooksApi.instantiateTemplate(workspaceId, templateId, csrfToken);
      setTemplatesModalOpen(false);
      setActionSuccess(`Template '${newPb.name}' instantiated and activated.`);
      navigate(`/playbooks/${newPb.id}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to instantiate template');
    } finally {
      setRunningAction(false);
    }
  };

  const handleExecute = async () => {
    if (!selectedPlaybookForRun) return;
    try {
      setRunningAction(true);
      const execution = await playbooksApi.executePlaybook(
        workspaceId,
        selectedPlaybookForRun.id,
        { incident_id: runIncidentId || undefined },
        csrfToken
      );
      setRunModalOpen(false);
      navigate(`/playbook-executions/${execution.id}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to trigger playbook execution');
    } finally {
      setRunningAction(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Playbooks & Workflow Automation</h1>
          <p className="text-sm text-muted-foreground">
            Configure automated runbooks, agentic investigations, and human-in-the-loop incident response.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => setTemplatesModalOpen(true)}
            className="border-border text-foreground hover:bg-secondary/80"
          >
            <Sparkles className="mr-2 size-4 text-violet-400" />
            Browse Templates
          </Button>
          <Button onClick={() => navigate('/playbooks/new')} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="mr-2 size-4" />
            New Playbook
          </Button>
        </div>
      </div>

      {actionSuccess && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-xs text-muted-foreground hover:text-white">
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

      {/* Filters Bar */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/60 p-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Status Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {(['all', 'active', 'draft', 'archived'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                statusFilter === status
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>

        {/* Search & Category Filter */}
        <div className="flex items-center gap-2">
          {categories.length > 0 && (
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              aria-label="Filter playbooks by category"
              className="rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c.replace('_', ' ').toUpperCase()}
                </option>
              ))}
            </select>
          )}

          <div className="relative">
            <Search className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search playbooks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchPlaybooks()}
              className="h-8 w-48 pl-8 text-xs"
            />
          </div>

          <Button variant="ghost" size="icon-sm" onClick={fetchPlaybooks} disabled={loading} title="Refresh">
            <RotateCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Playbooks Grid */}
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <RotateCw className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : playbooks.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed">
          <BookOpen className="size-10 text-muted-foreground mb-3 opacity-60" />
          <h3 className="text-base font-semibold text-white">No playbooks found</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            {statusFilter !== 'all' || searchQuery
              ? 'No playbooks match your current filter criteria.'
              : 'Automate operational responses by creating your first playbook or starting from a built-in template.'}
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setTemplatesModalOpen(true)}>
              Browse Templates
            </Button>
            <Button size="sm" onClick={() => navigate('/playbooks/new')}>
              Create Playbook
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {playbooks.map((pb) => {
            const statusVariant =
              pb.status === 'active'
                ? 'success'
                : pb.status === 'draft'
                ? 'warning'
                : pb.status === 'archived'
                ? 'danger'
                : 'muted';

            return (
              <Card
                key={pb.id}
                className="flex flex-col justify-between border-border bg-card/75 p-5 transition-all hover:border-primary/40 hover:bg-card/90"
              >
                <div className="space-y-3">
                  {/* Top badges */}
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={statusVariant}>{pb.status.toUpperCase()}</Badge>
                    <Badge variant="violet" className="truncate max-w-[140px]">
                      {pb.trigger_type.replace('_', ' ')}
                    </Badge>
                  </div>

                  {/* Title & Description */}
                  <div>
                    <h3
                      onClick={() => navigate(`/playbooks/${pb.id}`)}
                      className="cursor-pointer text-base font-semibold text-white transition-colors hover:text-primary"
                    >
                      {pb.name}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {pb.description || 'No description provided.'}
                    </p>
                  </div>

                  {/* Metrics */}
                  <div className="grid grid-cols-2 gap-2 border-y border-border/60 py-2.5 text-xs">
                    <div>
                      <span className="text-muted-foreground">Steps: </span>
                      <span className="font-semibold text-white">{pb.steps?.length || 0}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Executions: </span>
                      <span className="font-semibold text-white">{pb.execution_count}</span>
                    </div>
                  </div>

                  {pb.last_executed_at && (
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Clock className="size-3" />
                      <span>Last run: {new Date(pb.last_executed_at).toLocaleString()}</span>
                    </div>
                  )}
                </div>

                {/* Card Actions */}
                <div className="mt-4 flex items-center justify-between border-t border-border/40 pt-3">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => {
                      setSelectedPlaybookForRun(pb);
                      setRunModalOpen(true);
                    }}
                    className="h-8 gap-1.5 px-3 text-xs"
                  >
                    <Play className="size-3 fill-current" />
                    Run
                  </Button>

                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => navigate(`/playbooks/${pb.id}`)}
                      title="Inspect & Edit"
                    >
                      <ExternalLink className="size-3.5" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => handleDuplicate(pb.id)}
                      disabled={runningAction}
                      title="Duplicate Playbook"
                    >
                      <Copy className="size-3.5" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => handleArchive(pb.id)}
                      disabled={runningAction}
                      title="Archive Playbook"
                    >
                      <Archive className="size-3.5" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => handleDelete(pb.id, pb.name)}
                      disabled={runningAction}
                      title="Delete Playbook"
                      className="text-rose-400 hover:text-rose-300"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Browse Templates Modal */}
      {templatesModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="size-5 text-violet-400" />
                <h3 className="text-lg font-bold text-white">Operational Playbook Templates</h3>
              </div>
              <button
                onClick={() => setTemplatesModalOpen(false)}
                className="text-muted-foreground hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-muted-foreground mt-2">
              Instantiate production-ready playbooks instantly. All templates create fully editable playbooks in your
              workspace.
            </p>

            <div className="mt-4 space-y-3">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="flex flex-col justify-between gap-3 rounded-lg border border-border/80 bg-secondary/30 p-4 transition-colors hover:border-violet-500/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold text-white">{tpl.name}</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">{tpl.description}</p>
                    </div>
                    <Badge variant="violet" className="shrink-0">
                      {tpl.trigger_type.replace('_', ' ')}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <span className="text-[11px] text-muted-foreground">
                      {tpl.steps.length} sequential steps configured
                    </span>
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => handleInstantiateTemplate(tpl.id)}
                      disabled={runningAction}
                      className="h-8 text-xs bg-violet-600 hover:bg-violet-700"
                    >
                      Instantiate Template
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Manual Run Modal */}
      {runModalOpen && selectedPlaybookForRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Execute Playbook</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Trigger manual execution of <span className="text-white font-medium">{selectedPlaybookForRun.name}</span>.
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
                <p className="text-[11px] text-muted-foreground mt-1">
                  If provided, incident notes and severity updates will target this incident.
                </p>
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
                {runningAction ? 'Initiating...' : 'Start Execution'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
