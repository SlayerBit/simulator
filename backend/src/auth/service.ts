import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { getPrismaClient } from '../database/client.js';
import type { UserRole, UserIdentity } from '../types/domain.js';
import { loadConfig } from '../config/env.js';

const SALT_ROUNDS = 10;

interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signUserToken(user: UserIdentity): string {
  const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
  return jwt.sign(payload, loadConfig().jwtSecret, { expiresIn: '12h' });
}

export function verifyUserToken(token: string): UserIdentity | null {
  try {
    const decoded = jwt.verify(token, loadConfig().jwtSecret) as JwtPayload;
    return { id: decoded.sub, email: decoded.email, role: decoded.role };
  } catch {
    return null;
  }
}

export async function findUserByEmail(email: string) {
  return getPrismaClient().user.findUnique({ where: { email } });
}

export async function createUser(email: string, password: string, role: UserRole) {
  const passwordHash = await hashPassword(password);
  return getPrismaClient().user.create({
    data: { email, password: passwordHash, role },
  });
}

export async function ensureDefaultAdmin() {
  const defaultEmail = 'slayer@slayer.com';
  const existing = await findUserByEmail(defaultEmail);
  if (!existing) {
    await createUser(defaultEmail, 'slayer', 'admin');
    console.log('Default admin seeded: slayer@slayer.com');
  }
}

export function authMiddleware(requiredRoles?: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: { message: 'Missing or invalid Authorization header' } });
    }
    const token = authHeader.slice('Bearer '.length);
    const identity = verifyUserToken(token);
    if (!identity) {
      return res.status(401).json({ error: { message: 'Invalid or expired token' } });
    }

    if (requiredRoles && !requiredRoles.includes(identity.role)) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }

    (req as any).user = identity;
    return next();
  };
}

export type RequestWithUser = Request & { user?: UserIdentity };
