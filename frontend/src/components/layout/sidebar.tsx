import { NavLink } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Command, Radio } from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import { navigationItems } from './navigation'
import type { WorkspaceRole } from '../../features/auth/types'

type SidebarProps = {
  collapsed?: boolean
  mobile?: boolean
  onNavigate?: () => void
  onToggleCollapse?: () => void
  role?: WorkspaceRole
}

export function Sidebar({ collapsed = false, mobile = false, onNavigate, onToggleCollapse, role }: SidebarProps) {
  const visibleItems = navigationItems.filter((item) => item.path !== '/settings' || role === 'admin')
  return (
    <aside className={cn('flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground', collapsed && !mobile ? 'w-[76px]' : 'w-[252px]')}>
      <div className={cn('flex h-[76px] items-center border-b border-sidebar-border px-5', collapsed && !mobile && 'justify-center px-0')}>
        <NavLink to="/" onClick={onNavigate} className="flex min-w-0 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="NEXUS overview">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-sky-400/20 bg-gradient-to-br from-sky-400/20 to-blue-500/10 text-sky-300">
            <Command className="size-[19px]" strokeWidth={2.1} />
          </span>
          {(!collapsed || mobile) && (
            <span className="min-w-0 leading-tight">
              <span className="block text-[15px] font-semibold tracking-[0.13em] text-slate-100">NEXUS</span>
              <span className="mt-1 block text-[10px] font-medium uppercase tracking-[0.15em] text-slate-500">Operations platform</span>
            </span>
          )}
        </NavLink>
      </div>

      <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto px-3 py-5">
        {(!collapsed || mobile) && <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">Workspace</p>}
        <div className="space-y-1">
          {visibleItems.map((item, index) => {
            const Icon = item.icon
            const separator = index === 8
            return (
              <div key={item.path} className={cn(separator && 'mt-6 border-t border-sidebar-border pt-5')}>
                {separator && (!collapsed || mobile) && <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">Manage</p>}
                <NavLink
                  to={item.path}
                  end={item.path === '/'}
                  onClick={onNavigate}
                  title={collapsed && !mobile ? item.label : undefined}
                  aria-label={collapsed && !mobile ? item.label : undefined}
                  className={({ isActive }) => cn(
                    'group relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition-colors',
                    collapsed && !mobile && 'justify-center px-0',
                    isActive
                      ? 'bg-sky-400/[0.11] text-sky-200 before:absolute before:bottom-2 before:left-0 before:top-2 before:w-[2px] before:rounded-full before:bg-sky-300'
                      : 'text-slate-400 hover:bg-white/[0.045] hover:text-slate-100',
                  )}
                >
                  <Icon className="size-[17px] shrink-0" strokeWidth={1.8} />
                  {(!collapsed || mobile) && <span>{item.label}</span>}
                  {!collapsed && item.label === 'AI Investigations' && <span className="ml-auto rounded border border-violet-400/20 bg-violet-400/[0.08] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-300">AI</span>}
                </NavLink>
              </div>
            )
          })}
        </div>
      </nav>

      <div className={cn('mx-3 mb-3 rounded-lg border border-sidebar-border bg-white/[0.025] p-3', collapsed && !mobile && 'flex justify-center p-2')}>
        {collapsed && !mobile ? (
          <span aria-label="Platform online" title="Platform online" className="grid size-8 place-items-center rounded-md bg-emerald-400/10 text-emerald-300"><Radio className="size-4" /></span>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-300"><span className="size-1.5 rounded-full bg-emerald-400" /> Platform Active</div>
            <p className="mt-1.5 pl-3.5 text-[11px] leading-4 text-slate-500">Autonomous SRE Core</p>
          </>
        )}
      </div>

      {!mobile && onToggleCollapse && (
        <div className="border-t border-sidebar-border p-3">
          <Button variant="ghost" size="sm" onClick={onToggleCollapse} className={cn('w-full justify-start text-slate-500 hover:text-slate-200', collapsed && 'justify-center px-0')} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <ChevronRight /> : <><ChevronLeft className="size-4" /><span>Collapse sidebar</span></>}
          </Button>
        </div>
      )}
    </aside>
  )
}
