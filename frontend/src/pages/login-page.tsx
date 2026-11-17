import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Activity, ArrowRight, Command, LockKeyhole, ShieldCheck } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { useAuth } from '../features/auth/auth-context'

export function LoginPage() {
  const { status, login, error, reload } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const destination = (location.state as { from?: string } | null)?.from ?? '/'

  if (status === 'authenticated') return <Navigate to={destination} replace />

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    try {
      await login(email, password)
      navigate(destination, { replace: true })
    } catch {
      // The context retains a generic, user-safe error message.
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(35,119,205,0.12),transparent_55%)]" />
      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl lg:grid-cols-[1fr_0.9fr]">
        <section className="hidden flex-col justify-between border-r border-border bg-sidebar p-10 lg:flex">
          <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl border border-sky-400/20 bg-sky-400/10 text-sky-200"><Command className="size-5" /></span><span><span className="block text-sm font-semibold tracking-[0.16em]">NEXUS</span><span className="text-xs text-muted-foreground">Operations Workspace</span></span></div>
          <div><div className="mb-5 flex size-12 items-center justify-center rounded-xl border border-sky-400/20 bg-sky-400/[0.08] text-sky-200"><Activity className="size-5" /></div><h1 className="max-w-sm text-3xl font-semibold leading-tight tracking-[-0.035em]">Clarity for your next incident.</h1><p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">Bring service context, response workflows and evidence-backed investigation into one secure workspace.</p></div>
          <div className="flex items-center gap-2 text-xs text-slate-500"><ShieldCheck className="size-4 text-emerald-300" /> Protected workspace access</div>
        </section>

        <Card className="rounded-none border-0 bg-transparent shadow-none">
          <CardContent className="p-6 sm:p-10 lg:p-12">
            <div className="mb-8 flex items-center gap-3 lg:hidden"><span className="grid size-9 place-items-center rounded-lg border border-sky-400/20 bg-sky-400/10 text-sky-200"><Command className="size-4" /></span><span className="text-sm font-semibold tracking-[0.16em]">NEXUS</span></div>
            <div className="mb-8"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-300">Secure sign in</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">Welcome back</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Use the administrator credentials configured for this development workspace.</p></div>
            {status === 'error' && <div role="alert" className="mb-5 rounded-lg border border-rose-300/20 bg-rose-400/[0.06] p-3 text-sm text-rose-200">{error}<button type="button" onClick={() => void reload()} className="ml-2 underline underline-offset-4">Retry</button></div>}
            {error && status !== 'error' && <div role="alert" className="mb-5 rounded-lg border border-rose-300/20 bg-rose-400/[0.06] p-3 text-sm text-rose-200">{error}</div>}
            <form className="space-y-5" onSubmit={submit}>
              <label className="block space-y-2 text-sm font-medium" htmlFor="email">Email address<Input id="email" name="email" type="email" autoComplete="username" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" disabled={submitting} /></label>
              <label className="block space-y-2 text-sm font-medium" htmlFor="password">Password<Input id="password" name="password" type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" disabled={submitting} /></label>
              <Button type="submit" className="w-full" disabled={submitting || status === 'loading'}>{submitting ? 'Signing in…' : <>Sign in <ArrowRight className="size-4" /></>}</Button>
            </form>
            <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-border bg-background/50 p-3 text-xs leading-5 text-muted-foreground"><LockKeyhole className="mt-0.5 size-4 shrink-0 text-sky-300" /><p>Demo sign in is disabled until explicitly enabled in development configuration and the administrator has been seeded. No credentials are embedded in this interface.</p></div>
            <p className="mt-8 text-center text-xs text-slate-600">NEXUS · Development authentication</p>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
