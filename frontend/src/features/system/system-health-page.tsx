import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Cpu,
  Database,
  Radio,
  Server,
  Zap,
} from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { cn } from '../../lib/utils';
import { systemApi } from './api';
import type {
  DiagnosticsPingResponse,
  PlatformOverallStatus,
  SystemStatusResponse,
} from './types';

function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return '0s';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${Math.floor(seconds % 60)}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return `${h}h ${remM}m`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return `${d}d ${remH}h ${remM}m`;
}

function StatusPill({ status }: { status: PlatformOverallStatus }) {
  if (status === 'operational') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-400">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
        </span>
        All Systems Operational
      </span>
    );
  }
  if (status === 'degraded') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-amber-400">
        <span className="relative flex size-2">
          <span className="relative inline-flex size-2 rounded-full bg-amber-400" />
        </span>
        Degraded Performance
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/20 bg-rose-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-rose-400">
      <span className="relative flex size-2">
        <span className="relative inline-flex size-2 rounded-full bg-rose-400" />
      </span>
      Major System Outage
    </span>
  );
}

export function SystemHealthPage() {
  const [data, setData] = useState<SystemStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false);
  const [diagnosticsResult, setDiagnosticsResult] = useState<DiagnosticsPingResponse | null>(null);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(10);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const fetchStatus = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const resp = await systemApi.getStatus();
      setData(resp);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch platform health metrics.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    if (autoRefreshInterval <= 0) return;
    const interval = setInterval(() => {
      fetchStatus(true);
    }, autoRefreshInterval * 1000);
    return () => clearInterval(interval);
  }, [autoRefreshInterval]);

  const handleRunDiagnostics = async () => {
    setDiagnosticsRunning(true);
    try {
      const ping = await systemApi.runDiagnostics();
      setDiagnosticsResult(ping);
      await fetchStatus(true);
    } catch (err: any) {
      setError(err?.message || 'Diagnostic probe test failed to complete.');
    } finally {
      setDiagnosticsRunning(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Page Title & Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">System Health & Reliability</h1>
          <p className="mt-1 text-sm text-slate-400">
            Real-time infrastructure health, service dependencies, telemetry metrics, and diagnostic latency benchmarking.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-slate-400">
            <span>Auto-refresh:</span>
            <select
              value={autoRefreshInterval}
              onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
              className="rounded bg-transparent text-xs font-medium text-slate-200 outline-none hover:text-white"
            >
              <option value={10} className="bg-slate-900">10s</option>
              <option value={30} className="bg-slate-900">30s</option>
              <option value={0} className="bg-slate-900">Off</option>
            </select>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchStatus(false)}
            disabled={loading}
            className="gap-2 border-white/10 text-slate-300 hover:bg-white/[0.05]"
          >
            <Activity className={cn('size-4', loading && 'animate-spin')} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={handleRunDiagnostics}
            disabled={diagnosticsRunning}
            className="gap-2 bg-sky-500 text-slate-950 hover:bg-sky-400 font-semibold shadow-sm"
          >
            <Zap className={cn('size-4', diagnosticsRunning && 'animate-pulse text-amber-950')} />
            {diagnosticsRunning ? 'Probing Dependencies…' : 'Run Live Diagnostics'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="size-5 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => fetchStatus(false)}
            className="text-xs text-rose-200 underline hover:text-white"
          >
            Retry
          </button>
        </div>
      )}

      {/* Platform Status Banner */}
      {data && (
        <Card className="border-white/10 bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-950">
          <CardContent className="p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4">
                <StatusPill status={data.overall_status} />
                <div className="hidden h-6 w-px bg-white/10 md:block" />
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                  <span>Service: <strong className="font-mono text-slate-200">{data.service}</strong></span>
                  <span>•</span>
                  <span>Environment: <Badge variant="muted" className="text-[10px] uppercase font-mono">{data.environment}</Badge></span>
                  <span>•</span>
                  <span>Uptime: <strong className="text-slate-200">{formatUptime(data.uptime_seconds)}</strong></span>
                </div>
              </div>
              <div className="text-xs text-slate-500">
                Last checked: {lastUpdated.toLocaleTimeString()}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Diagnostic Probe Results (Interactive Benchmark Banner) */}
      {diagnosticsResult && (
        <Card className="border-sky-500/30 bg-sky-950/20 shadow-md">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="size-5 text-sky-400" />
                <CardTitle className="text-base text-slate-100">Live Diagnostic Probe Benchmarks</CardTitle>
              </div>
              <span className="text-xs font-mono text-sky-300">
                Total Latency: {diagnosticsResult.total_duration_ms}ms
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">PostgreSQL (SELECT 1)</span>
                  {diagnosticsResult.probes.database.ok ? (
                    <Badge variant="success" className="text-[10px]">PASS</Badge>
                  ) : (
                    <Badge variant="danger" className="text-[10px]">FAIL</Badge>
                  )}
                </div>
                <p className="mt-2 text-xl font-semibold text-slate-100">
                  {diagnosticsResult.probes.database.latency_ms} <span className="text-xs font-normal text-slate-400">ms</span>
                </p>
              </div>

              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">Redis Event Bus (PING)</span>
                  {diagnosticsResult.probes.redis.ok ? (
                    <Badge variant="success" className="text-[10px]">PASS (PubSub)</Badge>
                  ) : (
                    <Badge variant="warning" className="text-[10px]">FALLBACK</Badge>
                  )}
                </div>
                <p className="mt-2 text-xl font-semibold text-slate-100">
                  {diagnosticsResult.probes.redis.latency_ms} <span className="text-xs font-normal text-slate-400">ms</span>
                </p>
              </div>

              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">AI Inference Engine</span>
                  {diagnosticsResult.probes.llm.ok ? (
                    <Badge variant="success" className="text-[10px]">AVAILABLE</Badge>
                  ) : (
                    <Badge variant="danger" className="text-[10px]">OFFLINE</Badge>
                  )}
                </div>
                <p className="mt-2 text-xl font-semibold text-slate-100">
                  {diagnosticsResult.probes.llm.latency_ms} <span className="text-xs font-normal text-slate-400">ms</span>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Core Infrastructure Health (4-Card Grid) */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Core Infrastructure</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* API Gateway Card */}
          <Card className="border-white/10 bg-white/[0.02] transition-colors hover:border-white/20">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">API Gateway & Runtime</span>
                <span className="grid size-7 place-items-center rounded-md bg-blue-500/10 text-blue-400">
                  <Server className="size-4" />
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-emerald-400" />
                <span className="text-sm font-semibold text-slate-100">Healthy</span>
              </div>
              <div className="mt-4 space-y-1 text-xs text-slate-400">
                <div className="flex justify-between">
                  <span>Engine:</span>
                  <span className="font-mono text-slate-300">FastAPI / Uvicorn</span>
                </div>
                <div className="flex justify-between">
                  <span>Active In-flight:</span>
                  <span className="font-mono text-slate-300">{data?.telemetry.active_requests ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total Serviced:</span>
                  <span className="font-mono text-slate-300">{data?.telemetry.total_requests ?? 0}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* PostgreSQL Card */}
          <Card className="border-white/10 bg-white/[0.02] transition-colors hover:border-white/20">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">PostgreSQL Primary</span>
                <span className="grid size-7 place-items-center rounded-md bg-emerald-500/10 text-emerald-400">
                  <Database className="size-4" />
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'size-2 rounded-full',
                    data?.dependencies.database.status === 'healthy' ? 'bg-emerald-400' : 'bg-rose-400'
                  )}
                />
                <span className="text-sm font-semibold text-slate-100 capitalize">
                  {data?.dependencies.database.status ?? 'Checking…'}
                </span>
              </div>
              <div className="mt-4 space-y-1 text-xs text-slate-400">
                <div className="flex justify-between">
                  <span>Query Latency:</span>
                  <span className="font-mono text-slate-300">
                    {data?.dependencies.database.latency_ms ?? 0} ms
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Engine:</span>
                  <span className="font-mono text-slate-300">{data?.dependencies.database.engine ?? 'PostgreSQL'}</span>
                </div>
                {data?.dependencies.database.error && (
                  <p className="mt-1 text-[11px] text-rose-400">{data.dependencies.database.error}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Redis Real-Time Event Bus Card */}
          <Card className="border-white/10 bg-white/[0.02] transition-colors hover:border-white/20">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">Redis Event Bus</span>
                <span className="grid size-7 place-items-center rounded-md bg-purple-500/10 text-purple-400">
                  <Radio className="size-4" />
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'size-2 rounded-full',
                    data?.dependencies.redis.status === 'healthy' ? 'bg-emerald-400' : 'bg-amber-400'
                  )}
                />
                <span className="text-sm font-semibold text-slate-100">
                  {data?.dependencies.redis.status === 'healthy' ? 'Pub/Sub Stream Active' : 'Fallback Mode'}
                </span>
              </div>
              <div className="mt-4 space-y-1 text-xs text-slate-400">
                <div className="flex justify-between">
                  <span>Mode:</span>
                  <span className="font-mono text-slate-300">
                    {data?.dependencies.redis.mode === 'pubsub' ? 'Redis Cluster/PubSub' : 'In-Process Queues'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Ping Latency:</span>
                  <span className="font-mono text-slate-300">
                    {data?.dependencies.redis.latency_ms ? `${data.dependencies.redis.latency_ms} ms` : 'N/A (in-process)'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* AI Inference Engine Card */}
          <Card className="border-white/10 bg-white/[0.02] transition-colors hover:border-white/20">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">AI Investigation Engine</span>
                <span className="grid size-7 place-items-center rounded-md bg-cyan-500/10 text-cyan-400">
                  <Cpu className="size-4" />
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'size-2 rounded-full',
                    data?.dependencies.llm.status === 'ready' ? 'bg-emerald-400' : 'bg-rose-400'
                  )}
                />
                <span className="text-sm font-semibold text-slate-100 capitalize">
                  {data?.dependencies.llm.status === 'ready' ? 'Ready for Inferences' : 'Unavailable'}
                </span>
              </div>
              <div className="mt-4 space-y-1 text-xs text-slate-400">
                <div className="flex justify-between">
                  <span>Provider:</span>
                  <span className="font-mono text-slate-300">{data?.dependencies.llm.provider ?? 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Active Model:</span>
                  <span className="font-mono text-slate-300 truncate max-w-[120px]" title={data?.dependencies.llm.model}>
                    {data?.dependencies.llm.model ?? 'N/A'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Telemetry & Performance KPIs */}
      {data && (
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Performance & Telemetry</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="border-white/10 bg-white/[0.02]">
              <CardContent className="p-4">
                <span className="text-xs text-slate-400">Average Request Latency</span>
                <div className="mt-2 text-2xl font-bold tracking-tight text-slate-100">
                  {data.telemetry.avg_latency_ms} <span className="text-xs font-normal text-slate-400">ms</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">Across {data.telemetry.total_requests} measured calls</p>
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-white/[0.02]">
              <CardContent className="p-4">
                <span className="text-xs text-slate-400">P95 Latency Percentile</span>
                <div className="mt-2 text-2xl font-bold tracking-tight text-sky-400">
                  {data.telemetry.percentiles_ms.p95} <span className="text-xs font-normal text-slate-400">ms</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">P50: {data.telemetry.percentiles_ms.p50}ms • P99: {data.telemetry.percentiles_ms.p99}ms</p>
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-white/[0.02]">
              <CardContent className="p-4">
                <span className="text-xs text-slate-400">Error Rate (5xx)</span>
                <div className={cn(
                  'mt-2 text-2xl font-bold tracking-tight',
                  data.telemetry.error_rate_pct === 0 ? 'text-emerald-400' : 'text-rose-400'
                )}>
                  {data.telemetry.error_rate_pct}%
                </div>
                <p className="mt-1 text-[11px] text-slate-500">{data.telemetry.status_classes['5xx']} server errors</p>
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-white/[0.02]">
              <CardContent className="p-4">
                <span className="text-xs text-slate-400">Total Requests Serviced</span>
                <div className="mt-2 text-2xl font-bold tracking-tight text-slate-100">
                  {data.telemetry.total_requests.toLocaleString()}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">{data.telemetry.active_requests} currently in-flight</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Latency Percentiles & Status Code Distribution */}
      {data && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Latency Percentiles Breakdown */}
          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-slate-100">Latency Percentile Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs text-slate-300">
                    <span>P50 (Median)</span>
                    <span className="font-mono">{data.telemetry.percentiles_ms.p50} ms</span>
                  </div>
                  <div className="mt-1.5 h-2 w-full rounded-full bg-slate-800">
                    <div
                      className="h-2 rounded-full bg-emerald-400"
                      style={{ width: `${Math.min(100, Math.max(8, (data.telemetry.percentiles_ms.p50 / (data.telemetry.percentiles_ms.p99 || 1)) * 100))}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-300">
                    <span>P90 Percentile</span>
                    <span className="font-mono">{data.telemetry.percentiles_ms.p90} ms</span>
                  </div>
                  <div className="mt-1.5 h-2 w-full rounded-full bg-slate-800">
                    <div
                      className="h-2 rounded-full bg-sky-400"
                      style={{ width: `${Math.min(100, Math.max(15, (data.telemetry.percentiles_ms.p90 / (data.telemetry.percentiles_ms.p99 || 1)) * 100))}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-300">
                    <span>P95 Percentile</span>
                    <span className="font-mono">{data.telemetry.percentiles_ms.p95} ms</span>
                  </div>
                  <div className="mt-1.5 h-2 w-full rounded-full bg-slate-800">
                    <div
                      className="h-2 rounded-full bg-amber-400"
                      style={{ width: `${Math.min(100, Math.max(25, (data.telemetry.percentiles_ms.p95 / (data.telemetry.percentiles_ms.p99 || 1)) * 100))}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-300">
                    <span>P99 Percentile (Tail Latency)</span>
                    <span className="font-mono text-rose-300">{data.telemetry.percentiles_ms.p99} ms</span>
                  </div>
                  <div className="mt-1.5 h-2 w-full rounded-full bg-slate-800">
                    <div className="h-2 rounded-full bg-rose-400 w-full" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* HTTP Status Breakdown */}
          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-slate-100">Response Code Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs text-slate-300">
                    <span className="text-emerald-400 font-medium">2xx Success</span>
                    <span className="font-mono">{data.telemetry.status_classes['2xx']} requests</span>
                  </div>
                  <div className="mt-1.5 h-2 w-full rounded-full bg-slate-800">
                    <div
                      className="h-2 rounded-full bg-emerald-400"
                      style={{
                        width: `${data.telemetry.total_requests > 0 ? (data.telemetry.status_classes['2xx'] / data.telemetry.total_requests) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-300">
                    <span className="text-sky-400 font-medium">3xx Redirection</span>
                    <span className="font-mono">{data.telemetry.status_classes['3xx']} requests</span>
                  </div>
                  <div className="mt-1.5 h-2 w-full rounded-full bg-slate-800">
                    <div
                      className="h-2 rounded-full bg-sky-400"
                      style={{
                        width: `${data.telemetry.total_requests > 0 ? (data.telemetry.status_classes['3xx'] / data.telemetry.total_requests) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-300">
                    <span className="text-amber-400 font-medium">4xx Client Errors</span>
                    <span className="font-mono">{data.telemetry.status_classes['4xx']} requests</span>
                  </div>
                  <div className="mt-1.5 h-2 w-full rounded-full bg-slate-800">
                    <div
                      className="h-2 rounded-full bg-amber-400"
                      style={{
                        width: `${data.telemetry.total_requests > 0 ? (data.telemetry.status_classes['4xx'] / data.telemetry.total_requests) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-300">
                    <span className="text-rose-400 font-medium">5xx Server Failures</span>
                    <span className="font-mono">{data.telemetry.status_classes['5xx']} requests</span>
                  </div>
                  <div className="mt-1.5 h-2 w-full rounded-full bg-slate-800">
                    <div
                      className="h-2 rounded-full bg-rose-400"
                      style={{
                        width: `${data.telemetry.total_requests > 0 ? (data.telemetry.status_classes['5xx'] / data.telemetry.total_requests) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
