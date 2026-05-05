import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '../auth/service.js';
import { loadConfig } from '../config/env.js';

export const agent2Router = Router();

const AGENT2_EVENT_ORDER: Record<string, number> = {
  runbook_received: 10,
  runbook_parsed: 20,
  no_actions_found: 25,
  command_execution_started: 30,
  command_execution_success: 40,
  command_execution_failed: 40,
  runbook_completed: 50,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// GET /api/agent2/logs — proxies Agent 2 GET /logs (must be reachable from this Node process).
agent2Router.get('/logs', authMiddleware(['admin', 'engineer', 'viewer']), async (_req: Request, res: Response) => {
  const cfg = loadConfig();
  const url = cfg.agent2LogsUrl;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });

      if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        lastErr = new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`);
        if (attempt < 3) {
          await sleep(250 * attempt);
          continue;
        }
        return res.status(502).json({
          error: {
            message: `Agent 2 logs fetch failed: upstream HTTP ${resp.status} for ${url}.`,
            details: t.slice(0, 500),
          },
        });
      }

      const data = await resp.json().catch(() => ({ logs: [] }));
      const logs = Array.isArray((data as any)?.logs) ? (data as any).logs : [];
      const normalized = logs
        .map((row: any, idx: number) => {
          const ts = +new Date(String(row?.timestamp ?? ''));
          return {
            ...row,
            timestamp: Number.isFinite(ts) ? new Date(ts).toISOString() : new Date(0).toISOString(),
            _ts: Number.isFinite(ts) ? ts : 0,
            _eventOrder: AGENT2_EVENT_ORDER[String(row?.event ?? '')] ?? 999,
            _idx: idx,
          };
        })
        .sort((a: any, b: any) => {
          if (a._ts !== b._ts) return a._ts - b._ts;
          if (a._eventOrder !== b._eventOrder) return a._eventOrder - b._eventOrder;
          return a._idx - b._idx;
        })
        .map(({ _ts, _eventOrder, _idx, ...rest }: any) => rest);
      return res.json({ logs: normalized });
    } catch (e: unknown) {
      lastErr = e;
      if (attempt < 3) {
        await sleep(250 * attempt);
        continue;
      }
      const msg = e instanceof Error ? e.message : String(e);
      const hint =
        url.includes('.svc.cluster.local') && !process.env.KUBERNETES_SERVICE_HOST
          ? ' In-cluster URLs only resolve inside Kubernetes; set AGENT2_LOGS_URL to a reachable endpoint from this backend (e.g. http://127.0.0.1:8080/logs with kubectl port-forward, or run the backend as a Pod in the cluster).'
          : ' Set AGENT2_LOGS_URL to the Agent 2 /logs URL reachable from this process.';
      return res.json({ logs: [], warning: `${msg}.${hint}` });
    } finally {
      clearTimeout(timer);
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  return res.json({ logs: [], warning: msg });
});

