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

const STAGE_ORDER: Record<string, number> = {
  agent1_triggered: 10,
  runbook_generated: 20,
  runbook_sent_redis: 30,
  agent2_runbook_received: 40,
  agent2_executed: 50,
  recovery_successful: 60,
};

const EVENT_META: Record<string, { type: string; title: string; status: UiNotification['status'] }> = {
  'event.agent1_triggered': { type: 'agent1_triggered', title: 'Agent 1 triggered', status: 'info' },
  'event.runbook_generated': { type: 'runbook_generated', title: 'Runbook generated', status: 'success' },
  'event.runbook_sent_redis': { type: 'runbook_sent_redis', title: 'Runbook sent to Redis', status: 'info' },
};

export const notificationsRouter = Router();

function toMs(value: unknown): number {
  const n = +new Date(String(value ?? ''));
  return Number.isFinite(n) ? n : Date.now();
}

function makeAgent2Id(log: any, event: string, ts: string, idx: number): string {
  const runbookId = String(log?.runbook_id ?? '').trim();
  const command = String(log?.command ?? '').trim().slice(0, 120);
  const action = String(log?.action ?? '').trim();
  return `agent2-${runbookId || 'na'}-${event}-${ts}-${action}-${command}-${idx}`;
}

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

  const notif: Array<UiNotification & { _ts: number; _stage: number; _sourceIdx: number }> = [];
  let sourceIdx = 0;

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
      _ts: +a.createdAt,
      _stage: STAGE_ORDER[meta.type] ?? 999,
      _sourceIdx: sourceIdx++,
      ...(a.simulationId ? { simulation_id: a.simulationId } : {}),
      ...(md.runbook_id ? { runbook_id: String(md.runbook_id) } : {}),
    });
  }

  for (let i = 0; i < agent2Logs.length; i++) {
    const l = agent2Logs[i];
    const event = String(l?.event ?? '');
    let mapped: { type: string; title: string; status: UiNotification['status'] } | null = null;
    if (event === 'runbook_received') mapped = { type: 'agent2_runbook_received', title: 'Agent 2 received runbook', status: 'info' };
    else if (event === 'command_execution_success' || event === 'command_execution_failed')
      mapped = { type: 'agent2_executed', title: 'Agent 2 executed runbook', status: event.endsWith('failed') ? 'error' : 'success' };
    else if (event === 'runbook_completed')
      mapped = { type: 'recovery_successful', title: 'Recovery successful', status: 'success' };
    if (!mapped) continue;
    const runbookId = String(l?.runbook_id ?? '').trim();
    const ts = new Date(toMs(l?.timestamp)).toISOString();
    notif.push({
      id: makeAgent2Id(l, event, ts, i),
      type: mapped.type,
      title: mapped.title,
      message: String(l?.command ?? mapped.title),
      timestamp: ts,
      status: mapped.status,
      severity: mapped.status,
      _ts: toMs(ts),
      _stage: STAGE_ORDER[mapped.type] ?? 999,
      _sourceIdx: sourceIdx++,
      ...(runbookId ? { runbook_id: runbookId } : {}),
      ...(runbookId && simByRunbook.get(runbookId) ? { simulation_id: simByRunbook.get(runbookId)! } : {}),
    });
  }

  // Keep response newest-first, with deterministic tie-breaking by pipeline stage.
  notif.sort((a, b) => {
    if (b._ts !== a._ts) return b._ts - a._ts;
    if (a._stage !== b._stage) return a._stage - b._stage;
    if (a._sourceIdx !== b._sourceIdx) return a._sourceIdx - b._sourceIdx;
    return a.id.localeCompare(b.id);
  });

  const out: UiNotification[] = notif.slice(0, 100).map(({ _ts, _stage, _sourceIdx, ...rest }) => rest);
  res.json({ notifications: out });
});

