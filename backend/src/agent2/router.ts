import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '../auth/service.js';
import { loadConfig } from '../config/env.js';

export const agent2Router = Router();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// GET /api/agent2/logs — proxies Agent 2 GET /logs (must be reachable from this Node process).
agent2Router.get('/logs', authMiddleware(['admin', 'engineer', 'viewer']), async (_req: Request, res: Response) => {
  const cfg = loadConfig();
  const url = cfg.agent2LogsUrl.replace(/\s+/g, '');
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
        return res.status(502).json({ error: { message: 'Agent 2 logs fetch failed', details: t } });
      }

      const data = await resp.json().catch(() => ({ logs: [] }));
      const logs = Array.isArray((data as any)?.logs) ? (data as any).logs : [];
      return res.json({ logs });
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

