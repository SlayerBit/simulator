import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware, type RequestWithUser } from '../auth/service.js';
import { getPrismaClient } from '../database/client.js';

export const schedulesRouter = Router();

// GET /api/schedules
schedulesRouter.get('/', authMiddleware(['admin', 'engineer', 'viewer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const user = (req as RequestWithUser).user!;
  if (user.role !== 'admin') return res.status(403).json({ error: { message: 'Forbidden' } });
  const schedules = await prisma.schedule.findMany({ orderBy: { createdAt: 'desc' } });
  return res.json({ schedules });
});
