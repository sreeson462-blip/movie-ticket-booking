import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config';
import { one } from './db';
import { pool } from './db';
import { HttpError } from './errors';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: 'customer' | 'admin';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ sub: String(user.id) }, config.jwtSecret, { expiresIn: config.jwtExpiresIn } as jwt.SignOptions);
}

async function userFromHeader(header: string | undefined): Promise<AuthUser | null> {
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as jwt.JwtPayload;
    const id = Number(payload.sub);
    if (!Number.isInteger(id)) return null;
    // The role is read from the DB on every request, so a token can never grant more
    // than the user currently has (and deleted users are locked out immediately).
    const user = await one<AuthUser>(pool, 'SELECT id, name, email, role FROM users WHERE id = $1', [id]);
    return user ?? null;
  } catch {
    return null;
  }
}

/** Attaches req.user when a valid token is present; never rejects. */
export const optionalAuth: RequestHandler = async (req, _res, next) => {
  req.user = (await userFromHeader(req.headers.authorization)) ?? undefined;
  next();
};

/** Rejects with 401 unless a valid token is present. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const user = await userFromHeader(req.headers.authorization);
  if (!user) throw new HttpError(401, 'Please log in to continue');
  req.user = user;
  next();
};

/** Rejects with 401 (not logged in) or 403 (not an admin). */
export const requireAdmin: RequestHandler = async (req, _res, next) => {
  const user = await userFromHeader(req.headers.authorization);
  if (!user) throw new HttpError(401, 'Please log in to continue');
  if (user.role !== 'admin') throw new HttpError(403, 'Admin access required');
  req.user = user;
  next();
};
