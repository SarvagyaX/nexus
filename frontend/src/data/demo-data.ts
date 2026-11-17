export type IncidentSeverity = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4'
export type IncidentStatus = 'Investigating' | 'Monitoring' | 'Identified'
export type ServiceHealth = 'Operational' | 'Degraded' | 'Unknown'

export type DemoIncident = {
  id: string
  title: string
  service: string
  severity: IncidentSeverity
  status: IncidentStatus
  updated: string
  owner: string
}

export const demoIncidents: DemoIncident[] = [
  { id: 'INC-2481', title: 'Elevated checkout latency', service: 'payments-api', severity: 'SEV2', status: 'Investigating', updated: '4 min ago', owner: 'M. Chen' },
  { id: 'INC-2479', title: 'Intermittent webhook delivery', service: 'event-router', severity: 'SEV3', status: 'Monitoring', updated: '18 min ago', owner: 'A. Patel' },
  { id: 'INC-2476', title: 'Authentication timeout spike', service: 'identity-service', severity: 'SEV2', status: 'Identified', updated: '32 min ago', owner: 'J. Rivera' },
  { id: 'INC-2472', title: 'Elevated cache miss rate', service: 'catalog-api', severity: 'SEV3', status: 'Monitoring', updated: '1 hr ago', owner: 'K. Morgan' },
]

export const demoServices: Array<{ name: string; description: string; health: ServiceHealth; latency: string; errorRate: string; change: string }> = [
  { name: 'api-gateway', description: 'Edge · Production', health: 'Operational', latency: '84 ms', errorRate: '0.12%', change: '−12 ms' },
  { name: 'payments-api', description: 'Payments · Production', health: 'Degraded', latency: '428 ms', errorRate: '1.84%', change: '+96 ms' },
  { name: 'identity-service', description: 'Identity · Production', health: 'Operational', latency: '112 ms', errorRate: '0.38%', change: '−8 ms' },
  { name: 'event-router', description: 'Platform · Production', health: 'Operational', latency: '67 ms', errorRate: '0.06%', change: '−3 ms' },
  { name: 'catalog-api', description: 'Commerce · Production', health: 'Unknown', latency: '—', errorRate: '—', change: 'No recent samples' },
]

export const requestTrend = [
  { time: '00:00', requests: 1420, errors: 18 },
  { time: '02:00', requests: 1180, errors: 12 },
  { time: '04:00', requests: 960, errors: 9 },
  { time: '06:00', requests: 1280, errors: 13 },
  { time: '08:00', requests: 2040, errors: 21 },
  { time: '10:00', requests: 2640, errors: 46 },
  { time: '12:00', requests: 2910, errors: 63 },
  { time: '14:00', requests: 2520, errors: 38 },
  { time: '16:00', requests: 2760, errors: 32 },
  { time: '18:00', requests: 2380, errors: 27 },
  { time: '20:00', requests: 1960, errors: 24 },
  { time: '22:00', requests: 1610, errors: 17 },
]

export const demoActivity = [
  { initials: 'MC', actor: 'Mina Chen', action: 'updated the incident status', target: 'INC-2481', time: '4m ago', tone: 'blue' },
  { initials: 'AR', actor: 'Alex Rivera', action: 'added a note to', target: 'INC-2476', time: '19m ago', tone: 'violet' },
  { initials: 'KP', actor: 'Kavi Patel', action: 'moved the incident to monitoring on', target: 'event-router', time: '42m ago', tone: 'green' },
  { initials: 'SY', actor: 'System', action: 'recorded a service health check', target: 'api-gateway', time: '1h ago', tone: 'slate' },
]
