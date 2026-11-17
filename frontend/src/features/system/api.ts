import type { DiagnosticsPingResponse, SystemStatusResponse, TelemetrySnapshot } from './types';

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '');

export class SystemApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'SystemApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });
  } catch {
    throw new SystemApiError(
      'NEXUS API could not be reached. Ensure the backend service is running.',
      0,
      'network_error'
    );
  }

  if (!response.ok) {
    let errorCode = 'request_failed';
    let errorMessage = `HTTP ${response.status}: Failed to execute system operation.`;
    try {
      const errJson = await response.json();
      if (errJson?.error) {
        errorCode = errJson.error.code || errorCode;
        errorMessage = errJson.error.message || errorMessage;
      }
    } catch {
      // Ignore JSON parse error on non-JSON response
    }
    throw new SystemApiError(errorMessage, response.status, errorCode);
  }

  return response.json() as Promise<T>;
}

export const systemApi = {
  getStatus(): Promise<SystemStatusResponse> {
    return request<SystemStatusResponse>('/api/v1/system/status');
  },

  getMetrics(): Promise<TelemetrySnapshot> {
    return request<TelemetrySnapshot>('/api/v1/system/metrics');
  },

  runDiagnostics(): Promise<DiagnosticsPingResponse> {
    return request<DiagnosticsPingResponse>('/api/v1/system/diagnostics/ping', {
      method: 'POST',
    });
  },
};
