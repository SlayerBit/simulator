import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware, type RequestWithUser } from '../auth/service.js';
import { getPrismaClient } from '../database/client.js';

export const auditRouter = Router();

// GET /api/audit
auditRouter.get('/', authMiddleware(['admin', 'engineer', 'viewer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const user = (req as RequestWithUser).user!;

  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
  const skip = (page - 1) * limit;

  const where = user.role === 'admin' ? {} : { userId: user.id };
  
  const [events, total] = await Promise.all([
    prisma.auditLog.findMany({ 
      where, 
      orderBy: { createdAt: 'desc' }, 
      skip, 
      take: limit 
    }),
    prisma.auditLog.count({ where })
  ]);

  return res.json({ 
    events,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  });
});
