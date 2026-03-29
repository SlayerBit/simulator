import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware, type RequestWithUser } from '../auth/service.js';
import { getPrismaClient } from '../database/client.js';

export const auditRouter = Router();

// GET /api/audit
auditRouter.get('/', authMiddleware(['admin', 'engineer', 'viewer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const user = (req as RequestWithUser).user!;
  const where = user.role === 'admin' ? {} : { userId: user.id };
  const events = await prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
  return res.json({ events });
});
