import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Bell,
  Brain,
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  RefreshCw,
  Server,
  Settings,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../auth/auth-context';
import { notificationsApi, type ListNotificationParams } from './api';
import type { NotificationCategory, NotificationItem } from './types';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';

const CATEGORY_TABS: Array<{ label: string; value: NotificationCategory | 'all' }> = [
  { label: 'All', value: 'all' },
  { label: 'Alerts', value: 'alert' },
  { label: 'Incidents', value: 'incident' },
  { label: 'Investigations', value: 'investigation' },
  { label: 'System', value: 'system' },
];

function formatTimeAgo(isoString: string): string {
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${Math.max(1, diffSec)}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay}d ago`;
  } catch {
    return 'recently';
  }
}

function getCategoryIcon(category: NotificationCategory) {
  switch (category) {
    case 'alert':
      return <ShieldAlert className="size-4 text-rose-400" />;
    case 'incident':
      return <Activity className="size-4 text-amber-400" />;
    case 'investigation':
      return <Brain className="size-4 text-sky-400" />;
    case 'system':
      return <Server className="size-4 text-emerald-400" />;
    default:
      return <Bell className="size-4 text-slate-400" />;
  }
}

function getSeverityBadge(severity: string) {
  const s = severity.toUpperCase();
  if (s === 'SEV1' || s === 'CRITICAL') {
    return <Badge variant="danger" className="text-[10px] uppercase font-bold tracking-wider">SEV1</Badge>;
  }
  if (s === 'SEV2' || s === 'HIGH') {
    return <Badge variant="warning" className="text-[10px] uppercase font-bold tracking-wider">SEV2</Badge>;
  }
  if (s === 'SEV3' || s === 'WARNING') {
    return <Badge variant="warning" className="text-[10px] uppercase font-bold tracking-wider">SEV3</Badge>;
  }
  return <Badge variant="muted" className="text-[10px] uppercase font-medium tracking-wider">INFO</Badge>;
}

export function NotificationsPage() {
  const { activeWorkspaceId, csrfToken } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<NotificationCategory | 'all'>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNotifications = useCallback(
    async (reset: boolean = true) => {
      if (!activeWorkspaceId) return;
      if (reset) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError(null);

      try {
        const params: ListNotificationParams = {
          category: activeTab === 'all' ? undefined : activeTab,
          is_read: unreadOnly ? false : undefined,
          cursor: reset ? undefined : nextCursor ?? undefined,
          limit: 25,
        };
        const res = await notificationsApi.list(activeWorkspaceId, params);
        if (reset) {
          setItems(res.items);
        } else {
          setItems((prev) => [...prev, ...res.items]);
        }
        setTotalUnread(res.total_unread);
        setNextCursor(res.next_cursor ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load notifications.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [activeWorkspaceId, activeTab, unreadOnly, nextCursor]
  );

  useEffect(() => {
    void loadNotifications(true);
  }, [activeWorkspaceId, activeTab, unreadOnly]);

  const handleMarkAsRead = async (notificationId: string) => {
    if (!activeWorkspaceId) return;
    try {
      await notificationsApi.markRead(activeWorkspaceId, notificationId, csrfToken ?? undefined);
      setItems((prev) =>
        prev.map((item) => (item.id === notificationId ? { ...item, is_read: true } : item))
      );
      setTotalUnread((prev) => Math.max(0, prev - 1));
    } catch {
      // Ignore or log error
    }
  };

  const handleMarkAllRead = async () => {
    if (!activeWorkspaceId || items.length === 0) return;
    try {
      await notificationsApi.markAllRead(activeWorkspaceId, undefined, csrfToken ?? undefined);
      setItems((prev) => prev.map((item) => ({ ...item, is_read: true })));
      setTotalUnread(0);
    } catch {
      // Ignore
    }
  };

  const handleNotificationClick = (item: NotificationItem) => {
    if (!item.is_read) {
      void handleMarkAsRead(item.id);
    }
    if (item.link) {
      navigate(item.link);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-100">Notification Center</h1>
            {totalUnread > 0 && (
              <Badge variant="danger" className="rounded-full px-2 py-0.5 text-xs">
                {totalUnread} unread
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Centralized operational feed for system alerts, incident lifecycle events, and AI investigations.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {totalUnread > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleMarkAllRead()}
              className="gap-2 border-border/80 text-xs"
            >
              <CheckCheck className="size-3.5 text-sky-400" />
              Mark all as read
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadNotifications(true)}
            className="gap-2 border-border/80 text-xs"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/settings/notifications')}
            className="gap-2 border-border/80 text-xs text-slate-300"
          >
            <Settings className="size-3.5" />
            Preferences
          </Button>
        </div>
      </div>

      {/* Filter Tabs & Toggle */}
      <Card className="p-3 bg-card/60 backdrop-blur border-border/70">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {CATEGORY_TABS.map((tab) => {
              const active = activeTab === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setActiveTab(tab.value)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                    active
                      ? 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30'
                      : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 self-end sm:self-auto">
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => setUnreadOnly(e.target.checked)}
                className="rounded border-border bg-slate-900/60 text-sky-500 focus:ring-sky-500/20"
              />
              <span>Unread only</span>
            </label>
          </div>
        </div>
      </Card>

      {/* Notifications List */}
      {error && (
        <Card className="border-rose-500/30 bg-rose-500/[0.06] p-4 text-xs text-rose-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void loadNotifications(true)} className="h-7 text-xs">
            Retry
          </Button>
        </Card>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 rounded-lg border border-border/40 bg-card/40 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="p-12 text-center border-dashed border-border/80 bg-card/30">
          <div className="mx-auto grid size-12 place-items-center rounded-xl bg-slate-800/60 text-slate-400">
            <Bell className="size-6 text-slate-500" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-slate-200">No notifications found</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
            {unreadOnly
              ? "You're all caught up! There are no unread notifications matching your filter."
              : 'Notifications will appear here as incidents, alerts, and investigations occur.'}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <Card
              key={item.id}
              onClick={() => handleNotificationClick(item)}
              className={`group relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 transition-all cursor-pointer border-border/60 hover:border-slate-600/80 hover:bg-accent/[0.04] ${
                !item.is_read ? 'bg-sky-500/[0.03] border-sky-500/20 shadow-sm' : 'bg-card/40'
              }`}
            >
              {/* Unread indicator dot */}
              {!item.is_read && (
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 size-1.5 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]" />
              )}

              <div className="flex items-start gap-3.5 min-w-0 flex-1 pl-2">
                <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-slate-800/80 border border-border/50">
                  {getCategoryIcon(item.category)}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-slate-100 group-hover:text-sky-200 transition-colors">
                      {item.title}
                    </span>
                    {getSeverityBadge(item.severity)}
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="size-3" />
                      {formatTimeAgo(item.created_at)}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-slate-300/90 line-clamp-2">{item.message}</p>
                </div>
              </div>

              {/* Action buttons */}
              <div
                className="flex items-center gap-2 shrink-0 self-end sm:self-center pl-2"
                onClick={(e) => e.stopPropagation()}
              >
                {item.link && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(item.link!)}
                    className="h-8 gap-1.5 text-xs text-sky-400 hover:text-sky-300 hover:bg-sky-500/10"
                  >
                    <span>View</span>
                    <ExternalLink className="size-3" />
                  </Button>
                )}

                {!item.is_read && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleMarkAsRead(item.id)}
                    className="h-8 text-xs text-slate-400 hover:text-slate-100 hover:bg-slate-800"
                    title="Mark as read"
                  >
                    <Check className="size-3.5" />
                  </Button>
                )}
              </div>
            </Card>
          ))}

          {nextCursor && (
            <div className="pt-4 text-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadNotifications(false)}
                disabled={loadingMore}
                className="text-xs"
              >
                {loadingMore ? 'Loading more...' : 'Load older notifications'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
