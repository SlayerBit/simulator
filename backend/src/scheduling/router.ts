import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware, type RequestWithUser } from '../auth/service.js';
import { getPrismaClient } from '../database/client.js';

export const schedulesRouter = Router();

// GET /api/schedules
schedulesRouter.get('/', authMiddleware(['admin', 'engineer', 'viewer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const user = (req as RequestWithUser).user!;
  
  // Everyone can see schedules, but maybe we want to restrict some fields? 
  // Requirement says "create and manage schedules" usually implies admin/engineer.
  // We'll let everyone view.
  const schedules = await prisma.schedule.findMany({ 
    include: { template: true },
    orderBy: { createdAt: 'desc' } 
  });
  return res.json({ schedules });
});

// POST /api/schedules
schedulesRouter.post('/', authMiddleware(['admin', 'engineer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const { name, cronExpression, templateId, enabled } = req.body;

  try {
    const schedule = await prisma.schedule.create({
      data: {
        name,
        cronExpression,
        templateId,
        enabled: enabled ?? true,
      },
      include: { template: true },
    });
    return res.status(201).json({ schedule });
  } catch (err: any) {
    return res.status(400).json({ error: { message: err.message } });
  }
});

// PATCH /api/schedules/:id
schedulesRouter.patch('/:id', authMiddleware(['admin', 'engineer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const id = String(req.params.id);
  const data = req.body;

  try {
    const schedule = await prisma.schedule.update({
      where: { id },
      data,
      include: { template: true },
    });
    return res.json({ schedule });
  } catch (err: any) {
    return res.status(400).json({ error: { message: err.message } });
  }
});

// DELETE /api/schedules/:id
schedulesRouter.delete('/:id', authMiddleware(['admin', 'engineer']), async (req: Request, res: Response) => {
  const prisma = getPrismaClient();
  const id = String(req.params.id);
  await prisma.schedule.delete({ where: { id } });
  return res.status(204).send();
});
