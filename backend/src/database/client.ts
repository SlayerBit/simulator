import pkg from '@prisma/client';
import { loadDotenvIfNeeded } from '../config/load-dotenv.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

type PrismaClientType = {
  $disconnect: () => Promise<void>;
  [key: string]: any;
};

const PrismaClient = (pkg as any).PrismaClient as new (...args: any[]) => PrismaClientType;

let prisma: PrismaClientType | undefined;
let shutdownHandlersRegistered = false;
let pool: Pool | undefined;

export function getPrismaClient(): PrismaClientType {
  if (!prisma) {
    loadDotenvIfNeeded();

    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });

    const adapter = new PrismaPg(pool);

    prisma = new PrismaClient({
      adapter,
      log: ['error'],
    } as any);
  }

  if (!shutdownHandlersRegistered) {
    const disconnect = async () => {
      if (!prisma) return;

      await prisma.$disconnect();

      if (pool) {
        await pool.end();
      }

      prisma = undefined;
      pool = undefined;
    };

    process.on('beforeExit', () => {
      void disconnect();
    });

    process.on('SIGINT', () => {
      void disconnect().finally(() => process.exit(0));
    });

    process.on('SIGTERM', () => {
      void disconnect().finally(() => process.exit(0));
    });

    shutdownHandlersRegistered = true;
  }

  return prisma;
}