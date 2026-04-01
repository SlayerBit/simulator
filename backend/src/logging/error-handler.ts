import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger.js';

interface ErrorWithStatus extends Error {
  status?: number;
}

export function errorHandler(
  err: ErrorWithStatus,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;

  if (status >= 500) {
    logger.error({ err }, 'Unhandled server error');
  } else {
    logger.warn({ err, status }, 'Client request error');
  }

  res.status(status).json({
    error: {
      message: err.message || 'Internal Server Error',
      status,
    },
  });
}
