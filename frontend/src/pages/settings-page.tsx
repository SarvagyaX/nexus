import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bell,
  Building2,
  CheckCircle2,
  ExternalLink,
  Key,
  Lock,
  PhoneCall,
  Server,
  Shield,
  ShieldCheck,
  UserCheck,
  Workflow,
  Zap,
} from 'lucide-react'
import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { cn } from '../lib/utils'
import { useAuth } from '../features/auth/auth-context'
import type { WorkspaceRole } from '../features/auth/types'

const ROLE_PERMISSIONS_MAP: Record<WorkspaceRole, { name: string; description: string; permissions: string[] }> = {
  admin: {
    name: 'Administrator',
    description: 'Full workspace administrative access including membership, system settings, policies, and playbooks.',
    permissions: [
      'WORKSPACES_MANAGE',
      'SERVICE_MANAGE',
      'INCIDENT_WRITE',
      'INVESTIGATION_EXECUTE',
      'ALERT_MANAGE',
      'PLAYBOOK_MANAGE',
      'PLAYBOOK_EXECUTE',
      'PLAYBOOK_APPROVE',
      'ON_CALL_MANAGE',
      'ESCALATION_MANAGE',
      'AUDIT_READ',
    ],
  },
  commander: {
    name: 'Incident Commander',
    description: 'Operational leadership with authority over incident triage, severity escalation, investigation triggers, and playbook executions.',
    permissions: [
      'SERVICE_READ',
      'INCIDENT_WRITE',
      'INVESTIGATION_EXECUTE',
      'ALERT_RESPOND',
      'PLAYBOOK_EXECUTE',
      'PLAYBOOK_APPROVE',
      'ON_CALL_READ',
      'ESCALATION_READ',
      'AUDIT_READ',
    ],
  },
  responder: {
    name: 'Incident Responder',
    description: 'First-response engineering role with capabilities to inspect telemetry, triage alerts, update incidents, and execute assigned playbooks.',
    permissions: [
      'SERVICE_READ',
      'INCIDENT_WRITE',
      'INVESTIGATION_EXECUTE',
      'ALERT_RESPOND',
      'PLAYBOOK_EXECUTE',
      'PLAYBOOK_APPROVE',
      'ON_CALL_READ',
      'ESCALATION_READ',
    ],
  },
  viewer: {
    name: 'Read-Only Auditor',
    description: 'Auditing and monitoring capability with full read-only visibility into incidents, logs, telemetry, and audit logs.',
    permissions: [
      'SERVICE_READ',
      'INCIDENT_READ',
      'INVESTIGATION_READ',
      'ALERT_READ',
      'PLAYBOOK_READ',
      'ON_CALL_READ',
      'ESCALATION_READ',
      'AUDIT_READ',
    ],
  },
}

export function SettingsPage() {
  const { user, workspaces, activeWorkspaceId } = useAuth()
  const [activeTab, setActiveTab] = useState<'workspace' | 'access' | 'security' | 'integrations'>('workspace')

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)
  const role: WorkspaceRole = activeWorkspace?.role ?? 'viewer'
  const roleInfo = ROLE_PERMISSIONS_MAP[role]

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      {/* Header */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-400">Settings</p>
          <span className="text-slate-700">/</span>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Workspace Management</p>
        </div>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-slate-100 sm:text-[34px]">
              Workspace Settings
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Manage organization preferences, role-based permissions, security compliance, and platform integrations.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="success" className="border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
              <span className="mr-1.5 size-1.5 rounded-full bg-emerald-400" />
              Isolated Workspace
            </Badge>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-border/70 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('workspace')}
          className={cn(
            'flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors',
            activeTab === 'workspace'
              ? 'bg-sky-400/10 text-sky-300'
              : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
          )}
        >
          <Building2 className="size-3.5" />
          Workspace Profile
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('access')}
          className={cn(
            'flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors',
            activeTab === 'access'
              ? 'bg-sky-400/10 text-sky-300'
              : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
          )}
        >
          <UserCheck className="size-3.5" />
          Role & Permissions
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('security')}
          className={cn(
            'flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors',
            activeTab === 'security'
              ? 'bg-sky-400/10 text-sky-300'
              : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
          )}
        >
          <ShieldCheck className="size-3.5" />
          Security & Compliance
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('integrations')}
          className={cn(
            'flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors',
            activeTab === 'integrations'
              ? 'bg-sky-400/10 text-sky-300'
              : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
          )}
        >
          <Zap className="size-3.5" />
          Integration Hub
        </button>
      </div>

      {/* Tab: Workspace Profile */}
      {activeTab === 'workspace' && (
        <div className="grid gap-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-slate-100">Organization Profile</CardTitle>
              <p className="text-xs text-muted-foreground">General identity parameters for this operational workspace.</p>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-border/60 bg-white/[0.015] p-3.5">
                <p className="text-xs text-slate-500">Workspace Display Name</p>
                <p className="mt-1 text-sm font-medium text-slate-200">{activeWorkspace?.name ?? 'NEXUS Workspace'}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-white/[0.015] p-3.5">
                <p className="text-xs text-slate-500">Workspace Slug</p>
                <p className="mt-1 font-mono text-sm font-medium text-slate-200">{activeWorkspace?.slug ?? 'nexus-workspace'}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-white/[0.015] p-3.5">
                <p className="text-xs text-slate-500">Workspace Unique Identifier</p>
                <p className="mt-1 font-mono text-xs text-slate-400">{activeWorkspaceId ?? '—'}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-white/[0.015] p-3.5">
                <p className="text-xs text-slate-500">Data Isolation Model</p>
                <p className="mt-1 text-sm font-medium text-emerald-400">Workspace-Scoped PostgreSQL Schema</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-slate-100">All Available Workspaces</CardTitle>
              <p className="text-xs text-muted-foreground">Workspaces associated with your user session.</p>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-border/50">
                {workspaces.map((w) => (
                  <div key={w.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <span className="grid size-8 place-items-center rounded-lg bg-sky-400/10 font-bold text-sky-200 text-xs">
                        NX
                      </span>
                      <div>
                        <p className="text-sm font-medium text-slate-200">{w.name}</p>
                        <p className="text-xs font-mono text-slate-500">{w.slug}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="muted" className="capitalize text-slate-300">
                        {w.role}
                      </Badge>
                      {w.id === activeWorkspaceId && (
                        <Badge variant="violet" className="text-[10px]">Active</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tab: Role & Permissions */}
      {activeTab === 'access' && (
        <div className="grid gap-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base font-semibold text-slate-100">Your Current Membership Role</CardTitle>
                  <p className="text-xs text-muted-foreground">Granular permissions granted to your account in this workspace.</p>
                </div>
                <Badge variant="default" className="text-xs capitalize px-2.5 py-1">
                  {roleInfo.name}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-slate-400 leading-relaxed">{roleInfo.description}</p>
              <div className="rounded-lg border border-border/70 bg-slate-900/40 p-4">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Granted Platform Permissions</p>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3">
                  {roleInfo.permissions.map((perm) => (
                    <div key={perm} className="flex items-center gap-2 text-xs text-slate-300">
                      <CheckCircle2 className="size-3.5 text-emerald-400 shrink-0" />
                      <span className="font-mono text-[11px] text-slate-300">{perm}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-slate-100">Authenticated Identity</CardTitle>
              <p className="text-xs text-muted-foreground">Session identity parameters verified on every API interaction.</p>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-border/60 bg-white/[0.015] p-3.5">
                <p className="text-xs text-slate-500">Display Name</p>
                <p className="mt-1 text-sm font-medium text-slate-200">{user?.display_name ?? '—'}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-white/[0.015] p-3.5">
                <p className="text-xs text-slate-500">Email Address</p>
                <p className="mt-1 text-sm font-mono text-slate-200">{user?.email ?? '—'}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-white/[0.015] p-3.5">
                <p className="text-xs text-slate-500">User Identifier</p>
                <p className="mt-1 text-xs font-mono text-slate-400">{user?.id ?? '—'}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tab: Security & Compliance */}
      {activeTab === 'security' && (
        <div className="grid gap-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-slate-100">Security Architecture & Controls</CardTitle>
              <p className="text-xs text-muted-foreground">Enterprise security policies active in this installation.</p>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-white/[0.015] p-4">
                <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-sky-400/10 text-sky-300">
                  <Key className="size-4" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-200">Argon2id Password Hashing</p>
                  <p className="mt-1 text-[11px] leading-5 text-slate-400">
                    RFC 9106 recommended parameters with memory hardness, per-user salting, and zero cleartext persistence.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-white/[0.015] p-4">
                <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-400/10 text-emerald-300">
                  <Lock className="size-4" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-200">Server-Side Session Lifecycle</p>
                  <p className="mt-1 text-[11px] leading-5 text-slate-400">
                    Opaque 32-byte tokens hashed with SHA-256 in PostgreSQL. HttpOnly, SameSite=Lax, and configurable absolute TTL.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-white/[0.015] p-4">
                <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-400/10 text-violet-300">
                  <Shield className="size-4" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-200">Session-Bound CSRF Defense</p>
                  <p className="mt-1 text-[11px] leading-5 text-slate-400">
                    Cryptographically generated CSRF tokens validated on all unsafe HTTP methods (POST, PUT, PATCH, DELETE).
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-white/[0.015] p-4">
                <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-400/10 text-amber-300">
                  <Server className="size-4" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-200">Audit Logging & Immutability</p>
                  <p className="mt-1 text-[11px] leading-5 text-slate-400">
                    Append-only domain event logging recording user actions, IP addresses, correlation IDs, and timestamps.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tab: Integration Hub */}
      {activeTab === 'integrations' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            to="/settings/notifications"
            className="group flex flex-col justify-between rounded-xl border border-border bg-card p-5 transition-all hover:border-sky-400/30 hover:bg-white/[0.02]"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="grid size-9 place-items-center rounded-lg bg-sky-400/10 text-sky-300">
                  <Bell className="size-4" />
                </span>
                <ExternalLink className="size-4 text-slate-600 transition-colors group-hover:text-sky-300" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-slate-200">Notification Preferences</h3>
              <p className="mt-1 text-xs text-slate-400">
                Configure notification channels, min severity thresholds, email routing, and webhook destinations.
              </p>
            </div>
            <span className="mt-4 inline-flex items-center text-xs font-medium text-sky-300 group-hover:underline">
              Configure channels &rarr;
            </span>
          </Link>

          <Link
            to="/escalation-policies"
            className="group flex flex-col justify-between rounded-xl border border-border bg-card p-5 transition-all hover:border-sky-400/30 hover:bg-white/[0.02]"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="grid size-9 place-items-center rounded-lg bg-violet-400/10 text-violet-300">
                  <Workflow className="size-4" />
                </span>
                <ExternalLink className="size-4 text-slate-600 transition-colors group-hover:text-violet-300" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-slate-200">Escalation Policies</h3>
              <p className="mt-1 text-xs text-slate-400">
                Define multi-tiered operational escalation rules with automated fallback and step timeouts.
              </p>
            </div>
            <span className="mt-4 inline-flex items-center text-xs font-medium text-violet-300 group-hover:underline">
              Manage policies &rarr;
            </span>
          </Link>

          <Link
            to="/on-call"
            className="group flex flex-col justify-between rounded-xl border border-border bg-card p-5 transition-all hover:border-sky-400/30 hover:bg-white/[0.02]"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="grid size-9 place-items-center rounded-lg bg-emerald-400/10 text-emerald-300">
                  <PhoneCall className="size-4" />
                </span>
                <ExternalLink className="size-4 text-slate-600 transition-colors group-hover:text-emerald-300" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-slate-200">On-Call Rotations</h3>
              <p className="mt-1 text-xs text-slate-400">
                Manage team on-call shift schedules, primary/secondary assignments, and handover calendars.
              </p>
            </div>
            <span className="mt-4 inline-flex items-center text-xs font-medium text-emerald-300 group-hover:underline">
              View rotations &rarr;
            </span>
          </Link>

          <Link
            to="/playbooks"
            className="group flex flex-col justify-between rounded-xl border border-border bg-card p-5 transition-all hover:border-sky-400/30 hover:bg-white/[0.02]"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="grid size-9 place-items-center rounded-lg bg-amber-400/10 text-amber-300">
                  <Zap className="size-4" />
                </span>
                <ExternalLink className="size-4 text-slate-600 transition-colors group-hover:text-amber-300" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-slate-200">Workflow Automation</h3>
              <p className="mt-1 text-xs text-slate-400">
                Create and execute automated runbooks with approval gates, incident notes, and notifications.
              </p>
            </div>
            <span className="mt-4 inline-flex items-center text-xs font-medium text-amber-300 group-hover:underline">
              Explore playbooks &rarr;
            </span>
          </Link>
        </div>
      )}
    </div>
  )
}
