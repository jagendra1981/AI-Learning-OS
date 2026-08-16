import pino from 'pino';

const SENSITIVE_KEYS = /password|token|secret|api[-_]?key|authorization|cookie|prompt|stack/i;

export type LogLevel = 'info' | 'warn' | 'error';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'authorization', 'cookie', 'password', 'token', 'accessToken',
      'refreshToken', 'apiKey', 'secret', 'signedUrl', 'prompt', 'requestBody',
    ],
    remove: true,
  },
});

export function redactForLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForLog);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redactForLog(item),
    ]),
  );
}

export function writeStructuredLog(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  logger[level](redactForLog(fields) as Record<string, unknown>, event);
}
