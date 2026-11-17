import { Link } from 'react-router-dom'
import { ArrowLeft, SearchX } from 'lucide-react'
import { buttonVariants } from '../components/ui/button'

export function NotFoundPage() {
  return <section className="mx-auto flex min-h-[55vh] max-w-md flex-col items-center justify-center text-center"><span className="mb-5 grid size-12 place-items-center rounded-xl border border-border bg-card text-slate-400"><SearchX className="size-5" /></span><p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">404 · Page not found</p><h1 className="mt-2 text-2xl font-semibold text-slate-100">That route isn’t here</h1><p className="mt-2 text-sm leading-6 text-slate-400">The address may have changed, or this page is not part of the current demo.</p><Link to="/" className={`${buttonVariants({ variant: 'secondary', size: 'sm' })} mt-6`}><ArrowLeft className="size-4" /> Return to overview</Link></section>
}
