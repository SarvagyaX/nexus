import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Bell, Check, CheckCheck, ChevronDown, ExternalLink, LockKeyhole, Menu, Search, Settings, Settings2,
  ShieldCheck, Sparkles,
} from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import { useAuth } from '../../features/auth/auth-context'
import { notificationsApi } from '../../features/notifications/api'
import type { NotificationItem } from '../../features/notifications/types'
import { Sidebar } from './sidebar'
import { navigationItems } from './navigation'
import { SearchDialog } from './search-dialog'

function WorkspaceMenu({ workspaces, activeId, onChange }: { workspaces: { id: string; name: string; slug: string; role: string }[]; activeId: string | null; onChange: (id: string) => void }) {
  const active = workspaces.find((workspace) => workspace.id === activeId)
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="group flex h-10 max-w-[220px] items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors hover:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Select workspace">
          <span className="grid size-7 shrink-0 place-items-center rounded-md border border-sky-400/20 bg-sky-400/10 text-[10px] font-bold tracking-wide text-sky-200">NX</span>
          <span className="hidden min-w-0 sm:block"><span className="block truncate text-xs font-medium text-slate-200">{active?.name ?? 'Workspace'}</span><span className="mt-0.5 block text-[10px] capitalize text-slate-500">{active?.role ?? 'member'}</span></span>
          <ChevronDown className="hidden size-3.5 text-slate-500 transition-transform group-data-[state=open]:rotate-180 sm:block" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={8} className="z-50 w-64 rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-2xl outline-none">
          <p className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Your workspaces</p>
          <DropdownMenu.RadioGroup value={activeId ?? undefined} onValueChange={onChange}>
            {workspaces.map((workspace) => <DropdownMenu.RadioItem key={workspace.id} value={workspace.id} className="flex cursor-default items-center gap-3 rounded-lg px-2.5 py-2.5 outline-none focus:bg-accent data-[state=checked]:bg-accent/70">
              <span className="grid size-8 place-items-center rounded-md bg-sky-400/10 text-xs font-bold text-sky-200">NX</span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{workspace.name}</span><span className="mt-0.5 block text-xs capitalize text-muted-foreground">{workspace.role}{workspace.slug === 'nexus-demo' ? ' · demo workspace' : ''}</span></span>
              <DropdownMenu.ItemIndicator><Check className="size-4 text-sky-300" /></DropdownMenu.ItemIndicator>
            </DropdownMenu.RadioItem>)}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function NotificationMenu({ workspaceId, csrfToken }: { workspaceId: string | null; csrfToken: string | null }) {
  const [unread, setUnread] = useState(0)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (!workspaceId) return
    let active = true
    const fetchUnread = async () => {
      try {
        const count = await notificationsApi.getUnreadCount(workspaceId)
        if (active) setUnread(count)
      } catch {
        // ignore
      }
    }
    void fetchUnread()
    const timer = setInterval(() => void fetchUnread(), 20000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId || !open) return
    let active = true
    const fetchRecent = async () => {
      try {
        const res = await notificationsApi.list(workspaceId, { limit: 5 })
        if (active) {
          setNotifications(res.items)
          setUnread(res.total_unread)
        }
      } catch {
        // ignore
      }
    }
    void fetchRecent()
  }, [workspaceId, open])

  const handleMarkAllRead = async () => {
    if (!workspaceId) return
    try {
      await notificationsApi.markAllRead(workspaceId, undefined, csrfToken ?? undefined)
      setUnread(0)
      setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true })))
    } catch {
      // ignore
    }
  }

  const handleSelect = async (item: NotificationItem) => {
    setOpen(false)
    if (!item.is_read && workspaceId) {
      try {
        await notificationsApi.markRead(workspaceId, item.id, csrfToken ?? undefined)
        setUnread((prev) => Math.max(0, prev - 1))
      } catch {
        // ignore
      }
    }
    if (item.link) {
      navigate(item.link)
    } else {
      navigate('/notifications')
    }
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative text-slate-400 hover:text-slate-100"
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <Bell className="size-[17px]" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex size-2 items-center justify-center">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-sky-400 ring-2 ring-background" />
            </span>
          )}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={10}
          className="z-50 w-[min(380px,calc(100vw-24px))] rounded-xl border border-border bg-popover p-0 text-popover-foreground shadow-2xl outline-none"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-slate-100">Notifications</p>
              {unread > 0 && (
                <span className="rounded-full bg-sky-500/20 px-1.5 py-0.2 text-[10px] font-bold text-sky-300">
                  {unread} new
                </span>
              )}
            </div>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void handleMarkAllRead()}
                className="rounded-md px-2 py-1 text-xs font-medium text-sky-300 hover:bg-accent flex items-center gap-1"
              >
                <CheckCheck className="size-3" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[340px] overflow-y-auto divide-y divide-border/40 py-1">
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                No notifications right now.
              </div>
            ) : (
              notifications.map((item) => {
                const isSev1 = item.severity === 'SEV1' || item.severity === 'CRITICAL'
                const isSev2 = item.severity === 'SEV2' || item.severity === 'HIGH'
                const dotColor = isSev1 ? 'bg-rose-400' : isSev2 ? 'bg-amber-400' : 'bg-sky-400'
                return (
                  <DropdownMenu.Item
                    key={item.id}
                    onSelect={() => void handleSelect(item)}
                    className="flex cursor-pointer gap-3 px-4 py-3 outline-none hover:bg-accent/60 focus:bg-accent/60"
                  >
                    <span
                      className={cn(
                        'mt-1.5 size-2 shrink-0 rounded-full',
                        dotColor,
                        item.is_read && 'opacity-30'
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="block truncate text-xs font-medium text-slate-200">
                          {item.title}
                        </span>
                        <span className="text-[10px] text-slate-500 shrink-0">
                          {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.message}</p>
                    </div>
                  </DropdownMenu.Item>
                )
              })
            )}
          </div>

          <DropdownMenu.Separator className="h-px bg-border" />
          <div className="flex items-center justify-between px-3 py-2 text-[11px] bg-slate-900/40">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                navigate('/notifications')
              }}
              className="text-sky-400 hover:underline flex items-center gap-1"
            >
              <span>View all notifications</span>
              <ExternalLink className="size-3" />
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                navigate('/settings/notifications')
              }}
              className="text-slate-400 hover:text-slate-200 flex items-center gap-1"
            >
              <Settings className="size-3" />
              <span>Preferences</span>
            </button>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function ProfileMenu({ name, email, role, onSettings, onLogout, logoutError }: { name: string; email: string; role: string; onSettings: () => void; onLogout: () => void; logoutError: string | null }) {
  const initials = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild><button type="button" className="flex items-center gap-2 rounded-lg p-1.5 pr-2 transition-colors hover:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Open ${name} profile menu`}>
        <span className="grid size-8 place-items-center rounded-lg border border-violet-300/20 bg-violet-300/10 text-[11px] font-semibold text-violet-100">{initials}</span><span className="hidden text-left sm:block"><span className="block max-w-32 truncate text-xs font-medium text-slate-200">{name}</span><span className="mt-0.5 block max-w-32 truncate text-[10px] text-slate-500">{email}</span></span><ChevronDown className="hidden size-3.5 text-slate-500 sm:block" />
      </button></DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-60 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl outline-none">
        <div className="px-2.5 py-2"><p className="text-sm font-medium">{name}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{email}</p><p className="mt-1 text-[10px] capitalize text-sky-300">{role}</p></div>
        <DropdownMenu.Separator className="my-1 h-px bg-border" />
        {role === 'admin' && <DropdownMenu.Item onSelect={onSettings} className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none focus:bg-accent"><Settings2 className="size-4 text-muted-foreground" /> Workspace settings</DropdownMenu.Item>}
        <DropdownMenu.Separator className="my-1 h-px bg-border" />
        {logoutError && <p role="alert" className="px-2.5 py-2 text-xs text-rose-300">{logoutError}</p>}
        <div className="flex items-center gap-2 px-2.5 py-2 text-[11px] text-muted-foreground"><ShieldCheck className="size-3.5 text-emerald-400" /> Secure server session</div>
        <DropdownMenu.Item onSelect={onLogout} className="mt-1 flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm text-rose-200 outline-none focus:bg-rose-400/10"><LockKeyhole className="size-4" /> Sign out</DropdownMenu.Item>
      </DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const { user, workspaces, activeWorkspaceId, setActiveWorkspaceId, logout, csrfToken } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const membership = workspaces.find((workspace) => workspace.id === activeWorkspaceId)
  const role = membership?.role ?? 'viewer'
  const title = useMemo(() => {
    if (location.pathname.startsWith('/incidents/')) return 'Incident Detail'
    if (location.pathname.startsWith('/services/')) return 'Service Detail'
    if (location.pathname.startsWith('/alerts/')) return 'Alert Detail'
    if (location.pathname.startsWith('/investigations/')) return 'Investigation Detail'
    if (location.pathname.startsWith('/playbook-executions/')) return 'Playbook Execution'
    if (location.pathname.startsWith('/playbooks/')) return 'Playbook Detail'
    if (location.pathname === '/notifications') return 'Notifications'
    return navigationItems.find((item) => item.path === location.pathname)?.label ?? 'Overview'
  }, [location.pathname])

  async function signOut() {
    setLogoutError(null)
    try {
      await logout()
      navigate('/login', { replace: true })
    } catch (cause) {
      setLogoutError(cause instanceof Error ? cause.message : 'Sign out failed. Please retry.')
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground"><div className="flex min-h-screen">
      <div className="sticky top-0 hidden h-screen shrink-0 lg:block"><Sidebar collapsed={collapsed} role={role} onToggleCollapse={() => setCollapsed((value) => !value)} /></div>
      <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}><Dialog.Portal><Dialog.Overlay className="mobile-sheet-overlay fixed inset-0 z-50 bg-black/65 backdrop-blur-[2px] lg:hidden" /><Dialog.Content className="mobile-sheet-panel fixed left-0 top-0 z-50 h-dvh w-[min(84vw,280px)] border-r border-border bg-sidebar shadow-2xl outline-none lg:hidden" aria-label="Mobile navigation"><Dialog.Title className="sr-only">NEXUS navigation</Dialog.Title><Sidebar mobile role={role} onNavigate={() => setMobileOpen(false)} /><Dialog.Close className="absolute right-3 top-[22px] rounded-md p-1.5 text-slate-500 hover:bg-accent hover:text-foreground" aria-label="Close navigation"><span aria-hidden="true">×</span></Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-[70px] items-center justify-between gap-3 border-b border-border bg-background/95 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2 sm:gap-4"><Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu className="size-5" /></Button><WorkspaceMenu workspaces={workspaces} activeId={activeWorkspaceId} onChange={setActiveWorkspaceId} /><div className="hidden h-7 w-px bg-border md:block" /><div className="hidden min-w-0 items-center gap-2 text-sm md:flex"><span className="text-slate-500">Workspace</span><span className="text-slate-700">/</span><span className="truncate font-medium text-slate-200">{title}</span></div></div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-3"><Button variant="outline" size="sm" onClick={() => setSearchOpen(true)} className="h-9 w-9 justify-center px-0 text-slate-400 sm:w-[190px] sm:justify-start sm:px-3" aria-label="Search NEXUS"><Search className="size-4" /><span className="hidden flex-1 text-left text-xs font-normal sm:inline">Search anything</span><kbd className="hidden rounded border border-border px-1 py-0.5 text-[9px] text-slate-500 md:inline">⌘ K</kbd></Button><NotificationMenu workspaceId={activeWorkspaceId} csrfToken={csrfToken} /><span className="hidden h-7 w-px bg-border sm:block" /><ProfileMenu name={user?.display_name ?? 'Member'} email={user?.email ?? ''} role={role} onSettings={() => navigate('/settings')} onLogout={() => void signOut()} logoutError={logoutError} /></div>
        </header>
        <main id="main-content" className="mx-auto w-full max-w-[1600px] px-4 pb-10 pt-7 sm:px-6 sm:pt-9 lg:px-9"><Outlet /><footer className="mt-10 flex flex-col gap-2 border-t border-border/70 pt-4 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between"><span>NEXUS Enterprise Platform · Agentic AI Operations</span><span className="flex items-center gap-2"><Sparkles className="size-3.5 text-sky-400" /> Autonomous Incident Intelligence &amp; SRE Automation</span></footer></main>
      </div>
    </div><SearchDialog open={searchOpen} onOpenChange={setSearchOpen} role={role} /></div>
  )
}
