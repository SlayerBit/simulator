import { Router } from 'express';
import { authRouter } from '../auth/router.js';
import { simulationsRouter } from '../simulations/router.js';
import { auditRouter } from '../audit/router.js';
import { grafanaRouter } from '../grafana/router.js';
import { templatesRouter } from '../templates/router.js';
import { schedulesRouter } from '../scheduling/router.js';
import { dependenciesRouter } from '../dependencies/router.js';
import { metricsRouter } from '../metrics/router.js';
import { runbooksRouter } from '../runbooks/router.js';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/simulations', simulationsRouter);
apiRouter.use('/audit', auditRouter);
apiRouter.use('/grafana', grafanaRouter);
apiRouter.use('/templates', templatesRouter);
apiRouter.use('/schedules', schedulesRouter);
apiRouter.use('/dependencies', dependenciesRouter);
apiRouter.use('/metrics', metricsRouter);
apiRouter.use('/runbooks', runbooksRouter);
