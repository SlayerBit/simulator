import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '../auth/service.js';
import { loadConfig } from '../config/env.js';

export const agent2Router = Router();

// GET /api/agent2/logs
agent2Router.get('/logs', authMiddleware(['admin', 'engineer', 'viewer']), async (_req: Request, res: Response) => {
  const cfg = loadConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const resp = await fetch(cfg.agent2LogsUrl, {
      method: 'GET',
      headers: { 'accept': 'application/json' },
      signal: controller.signal,
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      return res.status(502).json({ error: { message: 'Agent 2 logs fetch failed', details: t } });
    }

    const data = await resp.json().catch(() => ({ logs: [] }));
    const logs = Array.isArray((data as any)?.logs) ? (data as any).logs : [];
    return res.json({ logs });
  } catch (e: any) {
    // Safe and non-fatal: return an empty list instead of failing the dashboard.
    return res.json({ logs: [], warning: e?.message ?? String(e) });
  } finally {
    clearTimeout(timer);
  }
});

