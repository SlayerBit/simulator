import pino from 'pino';
import { pinoHttp } from 'pino-http';

// Configure standard pino logger
const pinoOptions: any = {
  level: process.env.LOG_LEVEL || 'info',
  base: {
    env: process.env.NODE_ENV,
  },
};

if (process.env.NODE_ENV !== 'production') {
  pinoOptions.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  };
}

export const logger = pino(pinoOptions);

// Configure pino-http middleware for Express
export const httpLogger = pinoHttp({
  logger,
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      user: (req.raw as any).user?.id,
    }),
  },
});

export default logger;
