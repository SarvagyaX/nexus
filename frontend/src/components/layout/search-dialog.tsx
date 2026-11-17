import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Search } from 'lucide-react'
import { demoIncidents } from '../../data/demo-data'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { navigationItems } from './navigation'
import type { WorkspaceRole } from '../../features/auth/types'

type SearchDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  role?: WorkspaceRole
}

export function SearchDialog({ open, onOpenChange, role }: SearchDialogProps) {
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const results = useMemo(() => {
    const term = query.trim().toLowerCase()
    const pages = navigationItems
      .filter((item) => item.path !== '/settings' || role === 'admin')
      .filter((item) => !term || item.label.toLowerCase().includes(term))
      .map((item) => ({ label: item.label, detail: 'Navigate to page', path: item.path, kind: 'Page' }))
    const incidents = demoIncidents
      .filter((incident) => !term || `${incident.title} ${incident.service} ${incident.id}`.toLowerCase().includes(term))
      .slice(0, 4)
      .map((incident) => ({ label: incident.title, detail: `${incident.id} · ${incident.service}`, path: '/incidents', kind: 'Demo incident' }))
    return [...pages, ...incidents].slice(0, 8)
  }, [query, role])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onOpenChange(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onOpenChange])

  function go(path: string) {
    navigate(path)
    onOpenChange(false)
    setQuery('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[14vh] max-w-xl p-0" aria-describedby="search-description">
        <DialogTitle className="sr-only">Search NEXUS</DialogTitle>
        <DialogDescription id="search-description" className="sr-only">Quick search for pages, modules, and platform incidents.</DialogDescription>
        <div className="flex items-center gap-3 border-b border-border px-4 pr-12">
          <Search className="size-5 shrink-0 text-slate-500" />
          <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pages, services, incidents…" aria-label="Search pages, services, incidents" className="h-14 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" />
          <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-1 text-[10px] text-slate-500 sm:inline">ESC</kbd>
        </div>
        <div className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
          {results.length > 0 ? results.map((result) => (
            <button key={`${result.kind}:${result.label}`} type="button" onClick={() => go(result.path)} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-secondary text-slate-400"><Search className="size-4" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-200">{result.label}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{result.detail}</span></span>
              <span className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-slate-500">{result.kind}<ArrowRight className="size-3.5" /></span>
            </button>
          )) : <p className="px-3 py-10 text-center text-sm text-muted-foreground">No matching pages or incidents.</p>}
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[11px] text-slate-500"><span>Quick navigation &amp; incident locator</span><Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => { setQuery(''); onOpenChange(false) }}>Close</Button></div>
      </DialogContent>
    </Dialog>
  )
}
