import dotenv from 'dotenv';

export function loadDotenvIfNeeded(): void {
  const nodeEnv = process.env.NODE_ENV || 'development';
  if (nodeEnv === 'production') return;
  dotenv.config();
}

