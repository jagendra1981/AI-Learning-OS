type Labels = Record<string, string>;

const buckets = [0.05, 0.1, 0.25, 0.5, 1, 2, 5];

function key(labels: Labels) {
  return JSON.stringify(Object.fromEntries(Object.entries(labels).sort()));
}

export function normalizeRoute(path: string): string {
  return path
    .split('?')[0]
    .split('/')
    .map((part) => (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(part) || /^\d+$/.test(part) ? ':id' : part))
    .join('/') || '/';
}

export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly durations = new Map<string, { count: number; sum: number; buckets: number[] }>();
  private readonly gauges = new Map<string, number>();

  increment(name: string, labels: Labels = {}, value = 1) {
    const metricKey = `${name}|${key(labels)}`;
    this.counters.set(metricKey, (this.counters.get(metricKey) ?? 0) + value);
  }

  observe(name: string, labels: Labels, seconds: number) {
    const metricKey = `${name}|${key(labels)}`;
    const current = this.durations.get(metricKey) ?? { count: 0, sum: 0, buckets: buckets.map(() => 0) };
    current.count += 1;
    current.sum += seconds;
    buckets.forEach((bound, index) => { if (seconds <= bound) current.buckets[index] += 1; });
    this.durations.set(metricKey, current);
  }

  setGauge(name: string, labels: Labels, value: number) {
    this.gauges.set(`${name}|${key(labels)}`, value);
  }

  render(): string {
    const lines: string[] = [];
    for (const [metricKey, value] of this.counters) {
      const separator = metricKey.indexOf('|');
      const name = metricKey.slice(0, separator);
      const encoded = metricKey.slice(separator + 1);
      const labelsObject = encoded ? JSON.parse(encoded) as Labels : {};
      const labels = Object.keys(labelsObject).length ? `{${Object.entries(labelsObject).map(([k, v]) => `${k}="${v}"`).join(',')}}` : '';
      lines.push(`${name}${labels} ${value}`);
    }
    for (const [metricKey, value] of this.gauges) {
      const separator = metricKey.indexOf('|');
      const name = metricKey.slice(0, separator);
      const encoded = metricKey.slice(separator + 1);
      const labelsObject = encoded ? JSON.parse(encoded) as Labels : {};
      const labels = Object.keys(labelsObject).length ? `{${Object.entries(labelsObject).map(([k, v]) => `${k}="${v}"`).join(',')}}` : '';
      lines.push(`${name}${labels} ${value}`);
    }
    for (const [metricKey, value] of this.durations) {
      const separator = metricKey.indexOf('|');
      const name = metricKey.slice(0, separator);
      const encoded = metricKey.slice(separator + 1);
      const labelsObject = encoded ? JSON.parse(encoded) as Labels : {};
      const base = Object.entries(labelsObject).map(([k, v]) => `${k}="${v}"`).join(',');
      buckets.forEach((bound, index) => lines.push(`${name}_bucket{${base}${base ? ',' : ''}le="${bound}"} ${value.buckets[index]}`));
      lines.push(`${name}_bucket{${base}${base ? ',' : ''}le="+Inf"} ${value.count}`);
      lines.push(`${name}_sum${encoded ? `{${base}}` : ''} ${value.sum}`);
      lines.push(`${name}_count${encoded ? `{${base}}` : ''} ${value.count}`);
    }
    return `${lines.join('\n')}\n`;
  }
}

export const metrics = new MetricsRegistry();

export const DOMAIN_METRICS = Object.freeze({
  aiRequests: 'aio_ai_requests_total',
  aiLatency: 'aio_ai_request_duration_seconds',
  assessmentSessions: 'aio_assessment_sessions_total',
});
