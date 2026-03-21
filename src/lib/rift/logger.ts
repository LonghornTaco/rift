/**
 * Structured logger for Rift API routes.
 * Outputs JSON log entries with UTC timestamps in a consistent format
 * suitable for log aggregation and the Sitecore Marketplace security checklist.
 *
 * Log format follows Extended Log Format (ELF) principles with JSON encoding.
 */

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  route: string;
  detail?: string;
  clientIp?: string;
  [key: string]: unknown;
}

function emit(entry: LogEntry) {
  const line = JSON.stringify(entry);
  if (entry.level === 'ERROR') {
    console.error(line);
  } else if (entry.level === 'WARN') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function now(): string {
  return new Date().toISOString();
}

/** Log a successful authentication event. */
export function logAuth(route: string, clientIp: string, success: boolean, detail?: string) {
  emit({
    timestamp: now(),
    level: success ? 'INFO' : 'WARN',
    event: success ? 'auth_success' : 'auth_failure',
    route,
    clientIp,
    detail,
  });
}

/** Log an access control decision (e.g., CSRF rejection, rate limiting). */
export function logAccessControl(route: string, clientIp: string, decision: 'allow' | 'deny', reason: string) {
  emit({
    timestamp: now(),
    level: decision === 'deny' ? 'WARN' : 'INFO',
    event: 'access_control',
    route,
    clientIp,
    decision,
    reason,
  });
}

/** Log a sensitive operation (e.g., migration start/complete). */
export function logOperation(route: string, event: string, detail?: string, extra?: Record<string, unknown>) {
  emit({
    timestamp: now(),
    level: 'INFO',
    event,
    route,
    detail,
    ...extra,
  });
}

/** Log an error during request processing. */
export function logError(route: string, event: string, detail: string, extra?: Record<string, unknown>) {
  emit({
    timestamp: now(),
    level: 'ERROR',
    event,
    route,
    detail,
    ...extra,
  });
}

/** Log a rate-limit hit. */
export function logRateLimit(route: string, clientIp: string) {
  emit({
    timestamp: now(),
    level: 'WARN',
    event: 'rate_limited',
    route,
    clientIp,
  });
}
