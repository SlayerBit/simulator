export type NodeEnv = 'development' | 'test' | 'production';

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  backendBaseUrl: string | null;
  frontendBaseUrl: string | null;
  databaseUrl: string | null;
  grafanaUrl: string | null;
  prometheusUrl: string | null;
  lokiUrl: string | null;
  jwtSecret: string;
  simulatorNamespace: string;
  allowedTargetNamespaces: string[];
  globalKillSwitch: boolean;
  maxConcurrentSimulations: number;
  maxDurationSeconds: number;
  maxIntensityPercent: number;
  maxLatencyMs: number;
  maxPacketLossPercent: number;
  corsAllowedOrigins: (string | RegExp)[];
}

function parseNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV as NodeEnv) || 'development';
  const port = parseNumberEnv('PORT', 4000);

  const backendBaseUrl = process.env.BACKEND_BASE_URL ?? null;
  const frontendBaseUrl = process.env.FRONTEND_BASE_URL ?? null;
  const databaseUrl = process.env.DATABASE_URL ?? null;
  const grafanaUrl = process.env.GRAFANA_URL ?? null;
  const prometheusUrl = process.env.PROMETHEUS_URL ?? null;
  const lokiUrl = process.env.LOKI_URL ?? null;
  const jwtSecret = process.env.JWT_SECRET;
  const simulatorNamespace = process.env.SIMULATOR_NAMESPACE || 'simulator';
  // Fix: Change line 43 to allow more namespaces or a broader default
  const allowedTargetNamespaces = (process.env.ALLOWED_TARGET_NAMESPACES || 'simulator,default,production,staging')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const globalKillSwitch = (process.env.SIM_GLOBAL_KILL_SWITCH || 'false').toLowerCase() === 'true';
  const maxConcurrentSimulations = parseNumberEnv('SIM_MAX_CONCURRENT', 3);
  const maxDurationSeconds = parseNumberEnv('SIM_MAX_DURATION_SECONDS', 900);
  const maxIntensityPercent = parseNumberEnv('SIM_MAX_INTENSITY_PERCENT', 90);
  const maxLatencyMs = parseNumberEnv('SIM_MAX_LATENCY_MS', 2000);
  const maxPacketLossPercent = parseNumberEnv('SIM_MAX_PACKET_LOSS_PERCENT', 50);

  const allowedOriginsEnv = process.env.CORS_ALLOWED_ORIGINS;
  const corsAllowedOrigins: (string | RegExp)[] = [];
  if (allowedOriginsEnv) {
    for (const value of allowedOriginsEnv.split(',').map((v) => v.trim()).filter(Boolean)) {
      if (value.startsWith('/') && value.endsWith('/')) {
        const inner = value.slice(1, -1);
        corsAllowedOrigins.push(new RegExp(inner));
      } else {
        corsAllowedOrigins.push(value);
      }
    }
  } else if (frontendBaseUrl) {
    corsAllowedOrigins.push(frontendBaseUrl);
  } else {
    corsAllowedOrigins.push(/localhost:\d+/);
  }

  if (!jwtSecret) {
    throw new Error('Missing required environment variable: JWT_SECRET');
  }
  if (!databaseUrl) {
    throw new Error('Missing required environment variable: DATABASE_URL');
  }

  return {
    nodeEnv,
    port,
    backendBaseUrl,
    frontendBaseUrl,
    databaseUrl,
    grafanaUrl,
    prometheusUrl,
    lokiUrl,
    jwtSecret,
    simulatorNamespace,
    allowedTargetNamespaces,
    globalKillSwitch,
    maxConcurrentSimulations,
    maxDurationSeconds,
    maxIntensityPercent,
    maxLatencyMs,
    maxPacketLossPercent,
    corsAllowedOrigins,
  };
}
