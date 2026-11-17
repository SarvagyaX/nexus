export type PlatformOverallStatus = 'operational' | 'degraded' | 'major_outage';

export type DatabaseDependencyInfo = {
  status: 'healthy' | 'unhealthy';
  latency_ms: number;
  engine: string;
  error?: string | null;
};

export type RedisDependencyInfo = {
  status: 'healthy' | 'degraded';
  mode: 'pubsub' | 'in_process_fallback';
  latency_ms?: number;
  message?: string;
};

export type LLMDependencyInfo = {
  status: 'ready' | 'unavailable';
  provider: string;
  model: string;
  message?: string | null;
};

export type TelemetryPercentiles = {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
};

export type TelemetryStatusClasses = {
  '2xx': number;
  '3xx': number;
  '4xx': number;
  '5xx': number;
};

export type TelemetrySnapshot = {
  total_requests: number;
  active_requests: number;
  avg_latency_ms: number;
  percentiles_ms: TelemetryPercentiles;
  error_rate_pct: number;
  status_classes: TelemetryStatusClasses;
};

export type SystemStatusResponse = {
  overall_status: PlatformOverallStatus;
  service: string;
  environment: string;
  timestamp: string;
  uptime_seconds: number;
  dependencies: {
    database: DatabaseDependencyInfo;
    redis: RedisDependencyInfo;
    llm: LLMDependencyInfo;
  };
  telemetry: TelemetrySnapshot;
};

export type ProbeResult = {
  ok: boolean;
  latency_ms: number;
  mode?: string;
};

export type DiagnosticsPingResponse = {
  timestamp: string;
  total_duration_ms: number;
  probes: {
    database: ProbeResult;
    redis: ProbeResult;
    llm: ProbeResult;
  };
};
