import { z } from 'zod';

export const environmentValues = [
  'development',
  'test',
  'staging',
  'production',
] as const;
export type Environment = (typeof environmentValues)[number];

const rawEnvironmentSchema = z.object({
  APP_ENV: z.enum(environmentValues).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_APP_ENV: z.enum(environmentValues).optional(),
  DATABASE_URL: z.string().min(1).optional(),
  DIRECT_URL: z.string().min(1).optional(),
  TEST_DATABASE_URL: z.string().min(1).optional(),
  AUTH_ISSUER: z.string().url().optional(),
  AUTH_AUDIENCE: z.string().min(1).optional(),
  AUTH_CLIENT_SECRET: z.string().min(1).optional(),
  AI_PROVIDER: z.string().min(1).optional(),
  AI_MODEL: z.string().min(1).optional(),
  AI_API_KEY: z.string().min(1).optional(),
  REDIS_REST_URL: z.string().url().optional(),
  REDIS_REST_TOKEN: z.string().min(1).optional(),
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
  STORAGE_ENDPOINT: z.string().url().optional(),
  STORAGE_BUCKET: z.string().min(1).optional(),
  STORAGE_ACCESS_KEY: z.string().min(1).optional(),
  STORAGE_SECRET_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().email().optional(),
  EMAIL_SMTP_HOST: z.string().min(1).optional(),
  EMAIL_SMTP_PASSWORD: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type RawEnvironment = z.input<typeof rawEnvironmentSchema>;

export type ServerConfig = {
  app: { environment: Environment; apiPort: number; webOrigin: string };
  database: { url?: string; directUrl?: string; testUrl?: string };
  auth: { issuer?: string; audience?: string; clientSecret?: string };
  ai: { provider?: string; model?: string; apiKey?: string };
  cache: { redisRestUrl?: string; redisRestToken?: string };
  storage: {
    accountId?: string;
    publicBaseUrl?: string;
    endpoint?: string;
    bucket?: string;
    accessKey?: string;
    secretKey?: string;
  };
  email: { from?: string; smtpHost?: string; smtpPassword?: string };
  observability: { logLevel: 'debug' | 'info' | 'warn' | 'error' };
};

export type PublicConfig = { app: { environment: Environment } };

export class ConfigurationError extends Error {
  constructor(public readonly variableNames: string[]) {
    super(`Configuration validation failed for: ${variableNames.join(', ')}`);
    this.name = 'ConfigurationError';
  }
}

function parseEnvironment(
  input: Record<string, unknown>,
): z.output<typeof rawEnvironmentSchema> {
  const result = rawEnvironmentSchema.safeParse(input);
  if (!result.success) {
    const variableNames = [
      ...new Set(
        result.error.issues
          .map((issue) => issue.path[0])
          .filter((name): name is string => typeof name === 'string'),
      ),
    ];
    throw new ConfigurationError(variableNames);
  }
  const env = result.data;
  if (env.APP_ENV === 'production') {
    const productionIssues: string[] = [];
    if (!env.DATABASE_URL) productionIssues.push('DATABASE_URL');
    else {
      try {
        const databaseUrl = new URL(env.DATABASE_URL);
        if (databaseUrl.protocol !== 'postgresql:' && databaseUrl.protocol !== 'postgres:')
          productionIssues.push('DATABASE_URL');
      } catch {
        productionIssues.push('DATABASE_URL');
      }
    }
    if (!env.WEB_ORIGIN || /^https?:\/\/localhost(?::\d+)?$/i.test(env.WEB_ORIGIN))
      productionIssues.push('WEB_ORIGIN');
    if (productionIssues.length > 0)
      throw new ConfigurationError(productionIssues);
  }
  return env;
}

export function loadServerConfig(
  input: Record<string, unknown> = process.env,
): ServerConfig {
  const env = parseEnvironment(input);
  return {
    app: {
      environment: env.APP_ENV,
      apiPort: env.API_PORT,
      webOrigin: env.WEB_ORIGIN,
    },
    database: {
      url: env.DATABASE_URL,
      directUrl: env.DIRECT_URL,
      testUrl: env.TEST_DATABASE_URL,
    },
    auth: {
      issuer: env.AUTH_ISSUER,
      audience: env.AUTH_AUDIENCE,
      clientSecret: env.AUTH_CLIENT_SECRET,
    },
    ai: {
      provider: env.AI_PROVIDER,
      model: env.AI_MODEL,
      apiKey: env.AI_API_KEY,
    },
    cache: {
      redisRestUrl: env.REDIS_REST_URL,
      redisRestToken: env.REDIS_REST_TOKEN,
    },
    storage: {
      accountId: env.R2_ACCOUNT_ID,
      publicBaseUrl: env.R2_PUBLIC_BASE_URL,
      endpoint: env.STORAGE_ENDPOINT,
      bucket: env.STORAGE_BUCKET,
      accessKey: env.STORAGE_ACCESS_KEY,
      secretKey: env.STORAGE_SECRET_KEY,
    },
    email: {
      from: env.EMAIL_FROM,
      smtpHost: env.EMAIL_SMTP_HOST,
      smtpPassword: env.EMAIL_SMTP_PASSWORD,
    },
    observability: { logLevel: env.LOG_LEVEL },
  };
}

export function loadPublicConfig(
  input: Record<string, unknown> = process.env,
): PublicConfig {
  const env = parseEnvironment(input);
  return { app: { environment: env.NEXT_PUBLIC_APP_ENV ?? env.APP_ENV } };
}

const secretPaths = new Set([
  'database.url',
  'database.directUrl',
  'database.testUrl',
  'auth.clientSecret',
  'ai.apiKey',
  'storage.accessKey',
  'storage.secretKey',
  'email.smtpPassword',
]);

export type ConfigurationDiagnostics = Record<string, { configured: boolean }>;

export function redactServerConfig(
  config: ServerConfig,
): ConfigurationDiagnostics {
  const diagnostics: ConfigurationDiagnostics = {};
  const visit = (category: keyof ServerConfig) => {
    for (const [key, value] of Object.entries(config[category])) {
      const path = `${category}.${key}`;
      if (secretPaths.has(path))
        diagnostics[path] = {
          configured: typeof value === 'string' && value.length > 0,
        };
      else if (value !== undefined) diagnostics[path] = { configured: true };
    }
  };
  (Object.keys(config) as Array<keyof ServerConfig>).forEach(visit);
  return diagnostics;
}
