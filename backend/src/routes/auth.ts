import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { AuthUser, requireAuth, signToken } from '../auth';
import { config } from '../config';
import { PG, isPgError, one, pool } from '../db';
import { HttpError } from '../errors';

export const authRouter = Router();

const signupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
  // bcrypt only uses the first 72 bytes, so longer passwords would be silently truncated.
  password: z.string().min(8, 'Password must be at least 8 characters').max(72, 'Password must be at most 72 characters'),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string(),
});

const publicUser = (u: AuthUser) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

// Normal sign-up can only ever create customers: the role is not read from the request body.
authRouter.post('/signup', async (req, res) => {
  const { name, email, password } = signupSchema.parse(req.body);
  const hash = await bcrypt.hash(password, config.bcryptRounds);
  try {
    const user = await one<AuthUser>(
      pool,
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'customer')
       RETURNING id, name, email, role`,
      [name, email, hash],
    );
    res.status(201).json({ token: signToken(user!), user: publicUser(user!) });
  } catch (err) {
    if (isPgError(err, PG.UNIQUE_VIOLATION)) {
      throw new HttpError(409, 'An account with this email already exists. Try logging in instead.');
    }
    throw err;
  }
});

// Compared against when the email is unknown, so "no such user" costs the same time as "wrong password".
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', config.bcryptRounds);

authRouter.post('/login', async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const row = await one<AuthUser & { password_hash: string }>(
    pool,
    'SELECT id, name, email, role, password_hash FROM users WHERE lower(email) = $1',
    [email],
  );
  const ok = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) {
    // Same message either way: never reveal whether the email exists.
    throw new HttpError(401, 'Incorrect email or password');
  }
  res.json({ token: signToken(row), user: publicUser(row) });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user!) });
});
