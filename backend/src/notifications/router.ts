import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '../auth/service.js';
import { getPrismaClient } from '../database/client.js';
import { loadConfig } from '../config/env.js';

type UiNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  timestamp: string;
  status: 'info' | 'success' | 'warning' | 'error';
  severity: 'info' | 'success' | 'warning' | 'error';
  simulation_id?: string;
  runbook_id?: string;
};

const EVENT_META: Record<string, { type: string; title: string; status: UiNotification['status'] }> = {
  'event.agent1_triggered': { type: 'agent1_triggered', title: 'Agent 1 triggered', status: 'info' },
  'event.runbook_generated': { type: 'runbook_generated', title: 'Runbook generated', status: 'success' },
  'event.runbook_sent_redis': { type: 'runbook_sent_redis', title: 'Runbook sent to Redis', status: 'info' },
};

export const notificationsRouter = Router();

async function fetchAgent2Logs(): Promise<any[]> {
  const cfg = loadConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(cfg.agent2LogsUrl, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!resp.ok) return [];
    const payload = (await resp.json()) as any;
    return Array.isArray(payload?.logs) ? payload.logs : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

notificationsRouter.get('/', authMiddleware(['admin', 'engineer', 'viewer']), async (_req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const [auditLogs, runbooks, agent2Logs] = await Promise.all([
    prisma.auditLog.findMany({
      where: { action: { in: Object.keys(EVENT_META) as any } as any },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.agentRunbook.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { simulationId: true, payload: true },
    }),
    fetchAgent2Logs(),
  ]);

  const simByRunbook = new Map<string, string>();
  for (const rb of runbooks) {
    const payload = (rb.payload ?? {}) as any;
    const runbookId = String(payload?.runbook_id ?? '').trim();
    if (runbookId) simByRunbook.set(runbookId, rb.simulationId);
  }

  const notif: UiNotification[] = [];

  for (const a of auditLogs) {
    const meta = EVENT_META[a.action];
    if (!meta) continue;
    const md = (a.metadata ?? {}) as any;
    notif.push({
      id: `audit-${a.id}`,
      type: meta.type,
      title: meta.title,
      message: String(md.message ?? meta.title),
      timestamp: a.createdAt.toISOString(),
      status: meta.status,
      severity: meta.status,
      ...(a.simulationId ? { simulation_id: a.simulationId } : {}),
      ...(md.runbook_id ? { runbook_id: String(md.runbook_id) } : {}),
    });
  }

  for (const l of agent2Logs) {
    const event = String(l?.event ?? '');
    let mapped: { type: string; title: string; status: UiNotification['status'] } | null = null;
    if (event === 'runbook_received') mapped = { type: 'agent2_runbook_received', title: 'Agent 2 received runbook', status: 'info' };
    else if (event === 'command_execution_success' || event === 'command_execution_failed')
      mapped = { type: 'agent2_executed', title: 'Agent 2 executed runbook', status: event.endsWith('failed') ? 'error' : 'success' };
    else if (event === 'runbook_completed')
      mapped = { type: 'recovery_successful', title: 'Recovery successful', status: 'success' };
    if (!mapped) continue;
    const runbookId = String(l?.runbook_id ?? '').trim();
    notif.push({
      id: `agent2-${event}-${l?.timestamp ?? Math.random()}`,
      type: mapped.type,
      title: mapped.title,
      message: String(l?.command ?? mapped.title),
      timestamp: String(l?.timestamp ?? new Date().toISOString()),
      status: mapped.status,
      severity: mapped.status,
      ...(runbookId ? { runbook_id: runbookId } : {}),
      ...(runbookId && simByRunbook.get(runbookId) ? { simulation_id: simByRunbook.get(runbookId)! } : {}),
    });
  }

  notif.sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
  res.json({ notifications: notif.slice(0, 100) });
});

