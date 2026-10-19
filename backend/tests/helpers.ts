import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app';
import { pool } from '../src/db';

export const app = createApp();
export const api = () => request(app);
export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

let counter = 0;

export async function signup(name = 'Test User', email = `user${++counter}-${Date.now()}@example.com`, password = 'password123') {
  const res = await api().post('/api/auth/signup').send({ name, email, password });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token as string, user: res.body.user as { id: number; email: string }, email, password };
}

export async function createAdmin() {
  const email = `admin${++counter}@example.com`;
  const hash = await bcrypt.hash('adminpass123', 4);
  await pool.query(`INSERT INTO users (name, email, password_hash, role) VALUES ('Admin', $1, $2, 'admin')`, [email, hash]);
  const res = await api().post('/api/auth/login').send({ email, password: 'adminpass123' });
  return { token: res.body.token as string };
}

export async function insertMovie(opts: { title?: string; duration?: number } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO movies (title, language, duration_minutes, rating) VALUES ($1, 'English', $2, 'UA') RETURNING id`,
    [opts.title ?? 'Test Movie', opts.duration ?? 120],
  );
  return rows[0].id as number;
}

/** Insert a show directly in SQL (so tests can create shows in the past or soon). */
export async function insertShow(movieId: number, startsAt: Date, price = 200) {
  const { rows } = await pool.query(
    `INSERT INTO shows (movie_id, starts_at, ends_at, price)
     SELECT m.id, $2::timestamptz, $2::timestamptz + make_interval(mins => m.duration_minutes), $3 FROM movies m WHERE m.id = $1
     RETURNING id`,
    [movieId, startsAt.toISOString(), price],
  );
  return rows[0].id as number;
}

export const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000);

export const hold = (token: string, showId: number, seats: string[]) =>
  api().post(`/api/shows/${showId}/hold`).set(bearer(token)).send({ seats });

export const pay = (token: string, bookingId: string, outcome: 'success' | 'failure' = 'success') =>
  api().post(`/api/bookings/${bookingId}/pay`).set(bearer(token)).send({ outcome });

/** Pretend the 5 minutes ran out, without waiting. */
export const expireHold = (bookingId: string) =>
  pool.query(`UPDATE bookings SET hold_expires_at = now() - interval '1 second' WHERE id = $1`, [bookingId]);

export const seatMap = (showId: number, token?: string) => {
  const r = api().get(`/api/shows/${showId}/seats`);
  return token ? r.set(bearer(token)) : r;
};

export const statusOf = (body: any, label: string) => body.seats.find((s: any) => s.label === label).status as string;
