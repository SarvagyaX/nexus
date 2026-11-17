import {
  Activity, Brain, FileBarChart2, Gauge, HeartPulse,
  Logs, Network, PhoneCall, Settings2, ShieldAlert, Workflow, Zap,
  type LucideIcon,
} from 'lucide-react'

export type NavigationItem = {
  label: string
  path: string
  icon: LucideIcon
}

export const navigationItems: NavigationItem[] = [
  { label: 'Overview', path: '/', icon: Gauge },
  { label: 'Services', path: '/services', icon: Network },
  { label: 'Incidents', path: '/incidents', icon: Activity },
  { label: 'Alerts', path: '/alerts', icon: ShieldAlert },
  { label: 'On-Call', path: '/on-call', icon: PhoneCall },
  { label: 'Escalations', path: '/escalation-policies', icon: Workflow },
  { label: 'Playbooks', path: '/playbooks', icon: Zap },
  { label: 'Logs Explorer', path: '/logs', icon: Logs },
  { label: 'AI Investigations', path: '/investigations', icon: Brain },
  { label: 'System Health', path: '/system-health', icon: HeartPulse },
  { label: 'Reports', path: '/reports', icon: FileBarChart2 },
  { label: 'Settings', path: '/settings', icon: Settings2 },
]

export const overviewSectionItems = navigationItems.slice(0, 9)
export const workspaceSectionItems = navigationItems.slice(9)
