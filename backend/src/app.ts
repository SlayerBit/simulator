import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { loadConfig } from './config/env.js';
import { apiRouter } from './api/router.js';
import { httpLogger } from './logging/logger.js';
import { errorHandler } from './logging/error-handler.js';
import { registerAllFailureMethods } from './failures/methods.js';
export function createApp() {
  const config = loadConfig();
  const app = express();

  registerAllFailureMethods();

  app.use(helmet());
  app.use(
    cors({
      origin: config.corsAllowedOrigins,
      credentials: true,
    })
  );
  app.use(httpLogger);
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
    });
  });

  app.use('/api', apiRouter);

  app.use(errorHandler);

  return app;
}
