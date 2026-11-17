import { Link } from 'react-router-dom'
import { ArrowLeft, CircleDashed, LockKeyhole, Sparkles } from 'lucide-react'
import { Badge } from '../components/ui/badge'
import { buttonVariants } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'

const descriptions: Record<string, string> = {
  Services: 'A catalog for your software services, owners, environments, and health context.',
  Incidents: 'A shared command center for incident ownership, severity, status, and response history.',
  'Logs Explorer': 'Search structured application logs with bounded filters and clear source context.',
  'AI Investigations': 'Review staged, evidence-linked investigation findings and human decisions.',
  Reports: 'Explore operational trends and export reviewable incident reports.',
  Settings: 'Manage workspace preferences, membership, and future integrations.',
}

export function ComingSoonPage({ section }: { section: string }) {
  return (
    <div className="mx-auto max-w-4xl space-y-7">
      <div><div className="mb-2 flex items-center gap-2"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-300">Workspace</p><span className="text-slate-700">/</span><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{section}</p></div><h1 className="text-[28px] font-semibold tracking-[-0.04em] text-slate-100 sm:text-[34px]">{section}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{descriptions[section] ?? 'This workspace section will be available in a later milestone.'}</p></div>
      <Card className="overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-sky-400/60 via-blue-400/20 to-transparent" />
        <CardContent className="grid gap-8 p-6 sm:grid-cols-[auto_1fr] sm:items-center sm:p-9">
          <div className="grid size-14 place-items-center rounded-xl border border-sky-400/15 bg-sky-400/[0.06] text-sky-300"><CircleDashed className="size-6" /></div>
          <div><div className="mb-3 flex flex-wrap items-center gap-2"><Badge variant="muted"><LockKeyhole className="size-3" /> Not implemented</Badge><Badge variant="violet"><Sparkles className="size-3" /> Planned feature</Badge></div><h2 className="text-lg font-semibold text-slate-100">This section is coming in a later milestone</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">The navigation and application shell are ready. This page is intentionally a placeholder; there is no backend connection or live operational data here yet.</p><div className="mt-5 flex flex-wrap gap-3"><Link to="/" className={buttonVariants({ variant: 'secondary', size: 'sm' })}><ArrowLeft className="size-3.5" /> Back to overview</Link></div></div>
        </CardContent>
      </Card>
    </div>
  )
}
