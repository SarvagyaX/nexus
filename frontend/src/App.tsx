import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from './components/layout/app-shell'
import { LoginPage } from './pages/login-page'
import { NotFoundPage } from './pages/not-found-page'
import { OverviewPage } from './pages/overview-page'
import { ServicesPage } from './pages/services-page'
import { ServiceDetailPage } from './pages/service-detail-page'
import { SettingsPage } from './pages/settings-page'
import { ReportsPage } from './pages/reports-page'
import { IncidentsPage } from './features/incidents/incidents-page'
import { IncidentDetailPage } from './features/incidents/incident-detail-page'
import { AlertsPage } from './features/alerts/alerts-page'
import { AlertDetailPage } from './features/alerts/alert-detail-page'
import { AlertRulesPage } from './features/alerts/alert-rules-page'
import { LogsPage } from './features/logs/logs-page'
import { InvestigationsPage } from './features/investigations/investigations-page'
import { InvestigationDetailPage } from './features/investigations/investigation-detail-page'
import { SystemHealthPage } from './features/system/system-health-page'
import { NotificationsPage } from './features/notifications/notifications-page'
import { NotificationPreferencesPage } from './features/notifications/notification-preferences-page'
import { OnCallPage } from './features/on-call/on-call-page'
import { EscalationPoliciesPage } from './features/escalation/escalation-policies-page'
import { PlaybooksPage } from './features/playbooks/playbooks-page'
import { PlaybookCreatePage } from './features/playbooks/playbook-create-page'
import { PlaybookDetailPage } from './features/playbooks/playbook-detail-page'
import { PlaybookExecutionDetailPage } from './features/playbooks/playbook-execution-detail-page'
import { useAuth } from './features/auth/auth-context'

function ProtectedLayout() {
  const { status, error, reload } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return <main className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground" aria-live="polite">Checking secure session…</main>
  }
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (status === 'error') {
    return <main className="grid min-h-screen place-items-center bg-background px-5 text-foreground"><div className="max-w-md text-center"><h1 className="text-lg font-semibold">Authentication service unavailable</h1><p className="mt-2 text-sm text-muted-foreground">{error}</p><button type="button" onClick={() => void reload()} className="mt-4 text-sm text-sky-300 underline underline-offset-4">Retry</button></div></main>
  }
  return <AppShell />
}

function AdminOnly() {
  const { workspaces, activeWorkspaceId } = useAuth()
  const membership = workspaces.find((workspace) => workspace.id === activeWorkspaceId)
  if (membership?.role !== 'admin') {
    return <section role="alert" className="mx-auto max-w-3xl rounded-xl border border-amber-300/20 bg-amber-300/[0.04] p-6"><h1 className="text-lg font-semibold">Access restricted</h1><p className="mt-2 text-sm text-muted-foreground">Your workspace role does not allow access to administration.</p></section>
  }
  return <SettingsPage />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedLayout />}>
        <Route index element={<OverviewPage />} />
        <Route path="/overview" element={<Navigate to="/" replace />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/services/:serviceId" element={<ServiceDetailPage />} />
        <Route path="/incidents" element={<IncidentsPage />} />
        <Route path="/incidents/:incidentId" element={<IncidentDetailPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/alerts/rules" element={<AlertRulesPage />} />
        <Route path="/alerts/:alertId" element={<AlertDetailPage />} />
        <Route path="/on-call" element={<OnCallPage />} />
        <Route path="/escalation-policies" element={<EscalationPoliciesPage />} />
        <Route path="/playbooks" element={<PlaybooksPage />} />
        <Route path="/playbooks/new" element={<PlaybookCreatePage />} />
        <Route path="/playbooks/:playbookId" element={<PlaybookDetailPage />} />
        <Route path="/playbook-executions/:executionId" element={<PlaybookExecutionDetailPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings/notifications" element={<NotificationPreferencesPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/investigations" element={<InvestigationsPage />} />
        <Route path="/investigations/:investigationId" element={<InvestigationDetailPage />} />
        <Route path="/system-health" element={<SystemHealthPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<AdminOnly />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
