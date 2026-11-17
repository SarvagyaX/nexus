import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Clock,
  Edit2,
  Mail,
  Phone,
  PhoneCall,
  Plus,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react';
import { useAuth } from '../auth/auth-context';
import { onCallApi } from './api';
import type {
  CurrentOnCallResponse,
  OnCallMember,
  OnCallSchedule,
  OnCallScheduleCreate,
  RotationType,
} from './types';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';

export function OnCallPage() {
  const { activeWorkspaceId, csrfToken } = useAuth();

  const [schedules, setSchedules] = useState<OnCallSchedule[]>([]);
  const [currentMap, setCurrentMap] = useState<Record<string, CurrentOnCallResponse>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<OnCallSchedule | null>(null);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formTimezone, setFormTimezone] = useState('UTC');
  const [formRotationType, setFormRotationType] = useState<RotationType>('weekly');
  const [formIntervalDays, setFormIntervalDays] = useState(7);
  const [formHandoverHour, setFormHandoverHour] = useState(9);
  const [formMembers, setFormMembers] = useState<OnCallMember[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadSchedules = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const list = await onCallApi.list(activeWorkspaceId);
      setSchedules(list);

      // Fetch current on-call for each schedule in parallel
      const currentResults = await Promise.all(
        list.map(async (sched) => {
          try {
            const current = await onCallApi.getCurrent(activeWorkspaceId, sched.id);
            return { id: sched.id, data: current };
          } catch {
            return { id: sched.id, data: null };
          }
        })
      );
      const cMap: Record<string, CurrentOnCallResponse> = {};
      for (const res of currentResults) {
        if (res.data) cMap[res.id] = res.data;
      }
      setCurrentMap(cMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load on-call schedules.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  const openCreateModal = () => {
    setEditingSchedule(null);
    setFormName('');
    setFormDesc('');
    setFormTimezone('UTC');
    setFormRotationType('weekly');
    setFormIntervalDays(7);
    setFormHandoverHour(9);
    setFormMembers([
      { name: 'Primary SRE', email: 'primary@nexus.local', phone: '+1-555-0100', order: 0 },
      { name: 'Secondary SRE', email: 'secondary@nexus.local', phone: '+1-555-0101', order: 1 },
    ]);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (sched: OnCallSchedule) => {
    setEditingSchedule(sched);
    setFormName(sched.name);
    setFormDesc(sched.description ?? '');
    setFormTimezone(sched.timezone);
    setFormRotationType(sched.rotation_type);
    setFormIntervalDays(sched.rotation_interval_days);
    setFormHandoverHour(sched.handover_hour);
    setFormMembers(sched.members.length > 0 ? sched.members : [{ name: '', email: '', order: 0 }]);
    setFormError(null);
    setModalOpen(true);
  };

  const handleAddMember = () => {
    setFormMembers((prev) => [
      ...prev,
      { name: '', email: '', order: prev.length },
    ]);
  };

  const handleRemoveMember = (index: number) => {
    setFormMembers((prev) => prev.filter((_, i) => i !== index).map((m, idx) => ({ ...m, order: idx })));
  };

  const handleMemberChange = (index: number, field: keyof OnCallMember, val: string) => {
    setFormMembers((prev) =>
      prev.map((m, i) => (i === index ? { ...m, [field]: val } : m))
    );
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkspaceId) return;
    if (!formName.trim()) {
      setFormError('Schedule name is required.');
      return;
    }
    const cleanMembers = formMembers
      .filter((m) => m.name.trim().length > 0)
      .map((m, idx) => ({ ...m, order: idx }));
    if (cleanMembers.length === 0) {
      setFormError('At least one roster member is required.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const payload: OnCallScheduleCreate = {
        name: formName.trim(),
        description: formDesc.trim() || undefined,
        timezone: formTimezone,
        rotation_type: formRotationType,
        rotation_interval_days: formIntervalDays,
        handover_hour: formHandoverHour,
        members: cleanMembers,
      };

      if (editingSchedule) {
        await onCallApi.update(
          activeWorkspaceId,
          editingSchedule.id,
          payload,
          csrfToken ?? undefined
        );
      } else {
        await onCallApi.create(activeWorkspaceId, payload, csrfToken ?? undefined);
      }
      setModalOpen(false);
      await loadSchedules();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save schedule.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSchedule = async (scheduleId: string) => {
    if (!activeWorkspaceId) return;
    if (!window.confirm('Are you sure you want to delete this on-call schedule?')) return;
    try {
      await onCallApi.delete(activeWorkspaceId, scheduleId, csrfToken ?? undefined);
      await loadSchedules();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete schedule.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-100">On-Call Schedules</h1>
            <Badge variant="default">
              {schedules.length} {schedules.length === 1 ? 'Rotation' : 'Rotations'}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage deterministic responder shifts, handover times, and automated incident escalation targets.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadSchedules()}
            className="gap-2 border-border/80 text-xs"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={openCreateModal} className="gap-2 text-xs">
            <Plus className="size-3.5" />
            Create Schedule
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-rose-500/30 bg-rose-500/[0.06] p-4 text-xs text-rose-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void loadSchedules()} className="h-7 text-xs">
            Retry
          </Button>
        </Card>
      )}

      {/* Schedules List */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-48 rounded-xl border border-border/40 bg-card/40 animate-pulse" />
          ))}
        </div>
      ) : schedules.length === 0 ? (
        <Card className="p-12 text-center border-dashed border-border/80 bg-card/30">
          <div className="mx-auto grid size-12 place-items-center rounded-xl bg-slate-800/60 text-slate-400">
            <PhoneCall className="size-6 text-slate-500" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-slate-200">No on-call schedules configured</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
            Set up an on-call rotation so NEXUS knows who to page when high-severity incidents trigger.
          </p>
          <Button size="sm" onClick={openCreateModal} className="mt-4 gap-2 text-xs">
            <Plus className="size-3.5" />
            Create First Schedule
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {schedules.map((sched) => {
            const current = currentMap[sched.id];
            const currentMember = current?.current_user;

            return (
              <Card key={sched.id} className="p-6 border-border/70 bg-card/60 backdrop-blur space-y-5">
                {/* Top Row */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-border/50 pb-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-base font-bold text-slate-100">{sched.name}</h2>
                      <Badge
                        variant={sched.is_active ? 'success' : 'muted'}
                      >
                        {sched.is_active ? 'Active Rotation' : 'Disabled'}
                      </Badge>
                      <span className="text-xs text-muted-foreground font-mono">
                        {sched.rotation_type} ({sched.rotation_interval_days}d) · Handover {sched.handover_hour}:00 {sched.timezone}
                      </span>
                    </div>
                    {sched.description && (
                      <p className="mt-1 text-xs text-slate-300/80">{sched.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditModal(sched)}
                      className="h-8 gap-1.5 text-xs text-slate-300 hover:text-slate-100"
                    >
                      <Edit2 className="size-3" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleDeleteSchedule(sched.id)}
                      className="h-8 gap-1.5 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                    >
                      <Trash2 className="size-3" />
                      Delete
                    </Button>
                  </div>
                </div>

                {/* Current Active Responder Card */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl border border-sky-500/30 bg-sky-500/[0.05] space-y-2 md:col-span-1">
                    <span className="text-[11px] font-semibold tracking-wider uppercase text-sky-400 flex items-center gap-1.5">
                      <PhoneCall className="size-3.5" />
                      Currently On-Call
                    </span>
                    {currentMember ? (
                      <div className="space-y-1.5 pt-1">
                        <p className="text-sm font-bold text-slate-100">{currentMember.name}</p>
                        {currentMember.email && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                            <Mail className="size-3 text-slate-400" />
                            {currentMember.email}
                          </p>
                        )}
                        {currentMember.phone && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                            <Phone className="size-3 text-slate-400" />
                            {currentMember.phone}
                          </p>
                        )}
                        {current?.shift_end && (
                          <p className="text-[11px] text-sky-300/80 pt-1 flex items-center gap-1">
                            <Clock className="size-3" />
                            Shift ends {new Date(current.shift_end).toLocaleDateString()} at{' '}
                            {new Date(current.shift_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No active responder assigned</p>
                    )}
                  </div>

                  {/* Rotation Roster Order */}
                  <div className="p-4 rounded-xl border border-border/50 bg-background/40 md:col-span-2 space-y-2">
                    <span className="text-[11px] font-semibold tracking-wider uppercase text-slate-400 flex items-center gap-1.5">
                      <Users className="size-3.5" />
                      Roster Members ({sched.members.length})
                    </span>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {sched.members.map((member, idx) => {
                        const isCurrent = currentMember?.name === member.name;
                        return (
                          <div
                            key={idx}
                            className={`flex items-center justify-between p-2 rounded-lg border text-xs ${
                              isCurrent
                                ? 'border-sky-500/40 bg-sky-500/10 text-sky-200'
                                : 'border-border/40 bg-card/30 text-slate-300'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="grid size-5 place-items-center rounded-full bg-slate-800 text-[10px] font-mono font-bold text-slate-400">
                                {idx + 1}
                              </span>
                              <span className="font-medium truncate max-w-36">{member.name}</span>
                            </div>
                            {isCurrent && (
                              <Badge className="bg-sky-500/20 text-sky-300 text-[9px] uppercase border-sky-500/30">
                                On Shift
                              </Badge>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit Schedule Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-popover p-6 shadow-2xl space-y-5">
            <div>
              <h2 className="text-lg font-bold text-slate-100">
                {editingSchedule ? 'Edit On-Call Schedule' : 'Create On-Call Schedule'}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Define the rotation cycle, shift handover timing, and ordered roster members.
              </p>
            </div>

            {formError && (
              <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/[0.08] text-xs text-rose-300 flex items-center gap-2">
                <AlertTriangle className="size-4 shrink-0 text-rose-400" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveSchedule} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-300">Schedule Name *</label>
                <Input
                  required
                  placeholder="e.g. Primary SRE Rotation"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-300">Description</label>
                <Input
                  placeholder="e.g. Tier-1 operational incident responders"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300">Rotation Cycle</label>
                  <select
                    value={formRotationType}
                    onChange={(e) => {
                      const t = e.target.value as RotationType;
                      setFormRotationType(t);
                      if (t === 'daily') setFormIntervalDays(1);
                      if (t === 'weekly') setFormIntervalDays(7);
                    }}
                    className="w-full h-9 rounded-md border border-border bg-slate-900 px-3 text-xs text-slate-200"
                  >
                    <option value="daily">Daily (1 day)</option>
                    <option value="weekly">Weekly (7 days)</option>
                    <option value="custom">Custom interval</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300">Shift Length (Days)</label>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={formIntervalDays}
                    onChange={(e) => setFormIntervalDays(parseInt(e.target.value, 10) || 1)}
                    disabled={formRotationType !== 'custom'}
                    className="text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300">Handover Hour (0-23 UTC)</label>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={formHandoverHour}
                    onChange={(e) => setFormHandoverHour(parseInt(e.target.value, 10) || 0)}
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300">Timezone</label>
                  <Input
                    value={formTimezone}
                    onChange={(e) => setFormTimezone(e.target.value)}
                    className="text-xs"
                  />
                </div>
              </div>

              {/* Roster Members Builder */}
              <div className="space-y-2 pt-2 border-t border-border/50">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-200">Roster Members (Rotation Order)</label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleAddMember}
                    className="h-7 text-xs text-sky-400 hover:text-sky-300"
                  >
                    <Plus className="size-3" /> Add Member
                  </Button>
                </div>

                <div className="space-y-2">
                  {formMembers.map((member, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="grid size-6 place-items-center rounded bg-slate-800 text-[10px] text-slate-400 font-mono shrink-0">
                        {idx + 1}
                      </span>
                      <Input
                        placeholder="Responder Name"
                        value={member.name}
                        onChange={(e) => handleMemberChange(idx, 'name', e.target.value)}
                        className="text-xs flex-1"
                        required
                      />
                      <Input
                        type="email"
                        placeholder="Email"
                        value={member.email ?? ''}
                        onChange={(e) => handleMemberChange(idx, 'email', e.target.value)}
                        className="text-xs flex-1"
                      />
                      <Input
                        placeholder="Phone"
                        value={member.phone ?? ''}
                        onChange={(e) => handleMemberChange(idx, 'phone', e.target.value)}
                        className="text-xs w-28 shrink-0"
                      />
                      {formMembers.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleRemoveMember(idx)}
                          className="text-slate-500 hover:text-rose-400 shrink-0"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
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
                  {saving ? 'Saving...' : editingSchedule ? 'Save Changes' : 'Create Schedule'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
