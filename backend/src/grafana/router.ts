import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, type RequestWithUser } from '../auth/service.js';
import { loadConfig } from '../config/env.js';

export const grafanaRouter = Router();

// POST /api/grafana/annotate
grafanaRouter.post('/annotate', authMiddleware(['admin', 'engineer']), async (req: Request, res: Response) => {
  const config = loadConfig();
  const user = (req as RequestWithUser).user!;

  const Body = z.object({
    text: z.string().min(1).max(200),
    tags: z.array(z.string().min(1).max(50)).optional(),
    time: z.number().int().optional(),
  });
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { message: 'Invalid request', details: parsed.error.flatten() } });

  if (!config.grafanaUrl) {
    return res.status(400).json({ error: { message: 'GRAFANA_URL not configured' } });
  }
  const apiKey = process.env.GRAFANA_API_KEY;
  if (!apiKey) return res.status(400).json({ error: { message: 'GRAFANA_API_KEY not configured' } });

  const url = `${config.grafanaUrl.replace(/\/+$/, '')}/api/annotations`;
  const payload = {
    text: `[${user.email}] ${parsed.data.text}`,
    tags: parsed.data.tags ?? ['simulator'],
    time: parsed.data.time ?? Date.now(),
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    return res.status(502).json({ error: { message: 'Grafana annotation failed', details: t } });
  }

  const out = await resp.json().catch(() => ({}));
  return res.status(200).json({ ok: true, result: out });
});
