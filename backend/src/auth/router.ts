import { Router } from 'express';
import type { Request, Response } from 'express';
import { createUser, findUserByEmail, signUserToken, verifyUserToken } from './service.js';
import type { UserRole } from '../types/domain.js';

export const authRouter = Router();

interface SignupBody {
  email: string;
  password: string;
  role?: UserRole;
}

interface LoginBody {
  email: string;
  password: string;
}

// POST /api/auth/signup
authRouter.post('/signup', async (req: Request<unknown, unknown, SignupBody>, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: { message: 'email and password are required' } });
  }
  const userRole: UserRole = 'engineer';

  const existing = await findUserByEmail(email);
  if (existing) {
    return res.status(409).json({ error: { message: 'User already exists' } });
  }

  const user = await createUser(email, password, userRole);
  const identity = { id: user.id, email: user.email, role: user.role as UserRole };
  const token = signUserToken(identity);

  return res.status(201).json({ user: identity, token });
});

// POST /api/auth/login
authRouter.post('/login', async (req: Request<unknown, unknown, LoginBody>, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: { message: 'email and password are required' } });
  }

  const user = await findUserByEmail(email);
  if (!user) {
    return res.status(401).json({ error: { message: 'Invalid credentials' } });
  }

  const bcrypt = await import('bcrypt');
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: { message: 'Invalid credentials' } });
  }

  const identity = { id: user.id, email: user.email, role: user.role as UserRole };
  const token = signUserToken(identity);

  return res.status(200).json({ user: identity, token });
});

// POST /api/auth/logout
authRouter.post('/logout', (_req: Request, res: Response) => {
  return res.status(200).json({ message: 'Logged out (client should discard token).' });
});

// GET /api/auth/me
authRouter.get('/me', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(200).json({ authenticated: false });
  }
  const token = authHeader.slice('Bearer '.length);
  const identity = verifyUserToken(token);
  if (!identity) {
    return res.status(200).json({ authenticated: false });
  }
  return res.status(200).json({ authenticated: true, user: identity });
});
