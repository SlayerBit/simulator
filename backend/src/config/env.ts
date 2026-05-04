export type NodeEnv = 'development' | 'test' | 'production';
import { z } from 'zod';
export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  backendBaseUrl: string | null;
  frontendBaseUrl: string | null;
  databaseUrl: string | null;
  grafanaUrl: string | null;
  prometheusUrl: string | null;
  lokiUrl: string | null;
  agent1AnalyzeUrl: string;
  agent1AnalyzeDelayMs: number;
  agent2LogsUrl: string;
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
const envSchema = z.object({
  PORT: z.string().regex(/^\d+$/),
  JWT_SECRET: z.string().min(10),
  ALLOWED_TARGET_NAMESPACES: z.string(),
  API_KEY: z.string().min(10),
});

envSchema.parse(process.env);
function parseNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

let cachedConfig: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const nodeEnv = (process.env.NODE_ENV as NodeEnv) || 'development';
  const port = parseNumberEnv('PORT', 4000);

  const backendBaseUrl = process.env.BACKEND_BASE_URL ?? null;
  const frontendBaseUrl = process.env.FRONTEND_BASE_URL ?? null;
  const databaseUrl = process.env.DATABASE_URL ?? null;
  const grafanaUrl = process.env.GRAFANA_URL ?? null;
  const prometheusUrl = process.env.PROMETHEUS_URL ?? null;
  const lokiUrl = process.env.LOKI_URL ?? null;
  const agent1AnalyzeUrl =
    process.env.AGENT1_ANALYZE_URL ?? 'http://agent1.agent-system.svc.cluster.local:8000/analyze/live';
  // Agent 2 logs: cluster DNS only works from inside the same Kubernetes cluster.
  // Local dev: kubectl port-forward -n food-app svc/agent2 8080:80  →  http://127.0.0.1:8080/logs
  const agent2LogsUrlExplicit = process.env.AGENT2_LOGS_URL?.trim();
  const agent2LogsUrlDefaultInCluster = 'http://agent2.food-app.svc.cluster.local/logs';
  const agent2LogsUrlDefaultLocal = 'http://127.0.0.1:8080/logs';
  const agent2LogsUrl =
    agent2LogsUrlExplicit ||
    (process.env.KUBERNETES_SERVICE_HOST ? agent2LogsUrlDefaultInCluster : agent2LogsUrlDefaultLocal);
  if (
    agent2LogsUrlExplicit?.includes('.svc.cluster.local') &&
    !process.env.KUBERNETES_SERVICE_HOST
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      '[Config] AGENT2_LOGS_URL uses in-cluster DNS but this process is not running as a Kubernetes Pod (KUBERNETES_SERVICE_HOST unset). The Agent Activity proxy will usually fail DNS unless you provide routing. Run the backend in-cluster or set AGENT2_LOGS_URL to a reachable URL (NodePort, LB, VPN, or port-forward to localhost and use http://127.0.0.1:8080/logs).',
    );
  }
  // Keep this small: long delays push Agent 1 analysis past brief failure windows.
  const agent1AnalyzeDelayMs = Math.max(0, parseNumberEnv('AGENT1_ANALYZE_DELAY_MS', 2000));
  const jwtSecret = process.env.JWT_SECRET;
  const simulatorNamespace = process.env.SIMULATOR_NAMESPACE || 'simulator';
  // Fix: Change line 43 to allow more namespaces or a broader default
  const rawNamespaces = process.env.ALLOWED_TARGET_NAMESPACES;

  if (!rawNamespaces) {
    throw new Error('ALLOWED_TARGET_NAMESPACES must be set');
  }

  const allowedTargetNamespaces = rawNamespaces
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const globalKillSwitch = (process.env.SIM_GLOBAL_KILL_SWITCH || 'false').toLowerCase() === 'true';
  const maxConcurrentSimulations = parseNumberEnv('SIM_MAX_CONCURRENT', 4);
  const maxDurationSeconds = parseNumberEnv('SIM_MAX_DURATION_SECONDS', 900);
  const maxIntensityPercent = parseNumberEnv('SIM_MAX_INTENSITY_PERCENT', 90);
  const maxLatencyMs = parseNumberEnv('SIM_MAX_LATENCY_MS', 2000);
  const maxPacketLossPercent = parseNumberEnv('SIM_MAX_PACKET_LOSS_PERCENT', 50);

  const allowedOriginsEnv = process.env.CORS_ALLOWED_ORIGINS;
  const corsAllowedOrigins: (string | RegExp)[] = [];
  if (allowedOriginsEnv) {
    for (const value of allowedOriginsEnv
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)) {
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

  const config: AppConfig = {
    nodeEnv,
    port,
    backendBaseUrl,
    frontendBaseUrl,
    databaseUrl,
    grafanaUrl,
    prometheusUrl,
    lokiUrl,
    agent1AnalyzeUrl,
    agent1AnalyzeDelayMs,
    agent2LogsUrl,
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

  cachedConfig = config;
  return config;
}
