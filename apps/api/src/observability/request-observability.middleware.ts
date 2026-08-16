import { randomUUID } from 'node:crypto';
import { writeStructuredLog } from './structured-logger';
import { metrics, normalizeRoute } from './metrics';

type RequestLike = {
  method: string;
  originalUrl: string;
  header(name: string): string | undefined;
};
type ResponseLike = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  on(event: string, listener: () => void): void;
};
type NextFunction = () => void;

export function requestObservabilityMiddleware(
  request: RequestLike,
  response: ResponseLike,
  next: NextFunction,
): void {
  const correlationId = request.header('x-correlation-id') ?? randomUUID();
  const startedAt = Date.now();
  response.setHeader('x-correlation-id', correlationId);
  response.on('finish', () => {
    const route = normalizeRoute(request.originalUrl);
    const statusClass = `${Math.floor(response.statusCode / 100)}xx`;
    metrics.increment('aio_http_requests_total', { method: request.method, route, status_class: statusClass });
    if (response.statusCode >= 500) metrics.increment('aio_http_errors_total', { method: request.method, route });
    metrics.observe('aio_http_request_duration_seconds', { method: request.method, route }, (Date.now() - startedAt) / 1000);
    writeStructuredLog(response.statusCode >= 500 ? 'error' : 'info', 'http.request', {
      correlationId,
      method: request.method,
      route,
      statusCode: response.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });
  next();
}
