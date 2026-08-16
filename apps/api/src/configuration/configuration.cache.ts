import { Injectable } from '@nestjs/common';
export type ConfigurationProjection = {
  configurationVersionId: string;
  scopeKey: string;
  versionNumber: number;
  values: Record<string, unknown>;
};
@Injectable()
export class ConfigurationCache {
  private readonly entries = new Map<
    string,
    { value: ConfigurationProjection; expiresAt: number }
  >();
  key(scopeKey: string, versionId: string) {
    return `configuration:${scopeKey}:${versionId}`;
  }
  get(scopeKey: string, versionId: string) {
    const e = this.entries.get(this.key(scopeKey, versionId));
    if (!e || e.expiresAt <= Date.now()) return undefined;
    return e.value;
  }
  set(value: ConfigurationProjection, ttlMs = 60_000) {
    this.entries.set(this.key(value.scopeKey, value.configurationVersionId), {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }
  invalidate(scopeKey: string, versionId?: string) {
    for (const key of this.entries.keys())
      if (
        key.startsWith(`configuration:${scopeKey}:`) &&
        (!versionId || key.endsWith(`:${versionId}`))
      )
        this.entries.delete(key);
  }
  clear() {
    this.entries.clear();
  }
}
