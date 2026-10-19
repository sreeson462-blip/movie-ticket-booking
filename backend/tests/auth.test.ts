import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db';
import { resetDatabase } from '../src/migrate';
import { api, bearer, createAdmin, signup } from './helpers';

beforeAll(resetDatabase);
afterAll(() => pool.end());

describe('flow 1: sign up and log in', () => {
  it('creates an account, hashes the password, and always makes a customer', async () => {
    const res = await api()
      .post('/api/auth/signup')
      .send({ name: 'Asha', email: 'Asha@Example.com', password: 'password123', role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Asha', email: 'asha@example.com', role: 'customer' });

    const { rows } = await pool.query(`SELECT password_hash FROM users WHERE email = 'asha@example.com'`);
    expect(rows[0].password_hash).not.toContain('password123');
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/); // bcrypt
  });

  it('rejects a duplicate email (case-insensitive) with a clear message', async () => {
    const res = await api().post('/api/auth/signup').send({ name: 'Other', email: 'ASHA@example.com', password: 'password123' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('rejects passwords shorter than 8 characters', async () => {
    const res = await api().post('/api/auth/signup').send({ name: 'Short', email: 'short@example.com', password: '1234567' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 8/);
  });

  it('logs in, and gives the same error for a wrong email and a wrong password', async () => {
    const ok = await api().post('/api/auth/login').send({ email: 'asha@example.com', password: 'password123' });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();

    const wrongPassword = await api().post('/api/auth/login').send({ email: 'asha@example.com', password: 'nope-nope-nope' });
    const wrongEmail = await api().post('/api/auth/login').send({ email: 'ghost@example.com', password: 'password123' });
    expect(wrongPassword.status).toBe(401);
    expect(wrongEmail.status).toBe(401);
    expect(wrongPassword.body.error).toBe(wrongEmail.body.error);
  });

  it('rejects protected API calls without a valid login', async () => {
    expect((await api().get('/api/bookings')).status).toBe(401);
    expect((await api().get('/api/bookings/BK-123')).status).toBe(401);
    expect((await api().post('/api/shows/1/hold').send({ seats: ['A1'] })).status).toBe(401);
    expect((await api().post('/api/bookings/BK-123/pay').send({ outcome: 'success' })).status).toBe(401);
    expect((await api().get('/api/bookings').set(bearer('garbage.token.value'))).status).toBe(401);
  });
});

describe('flow 7: role separation', () => {
  it('blocks customers and anonymous users from admin APIs', async () => {
    const customer = await signup();
    const admin = await createAdmin();

    expect((await api().get('/api/admin/shows')).status).toBe(401);
    expect((await api().get('/api/admin/shows').set(bearer(customer.token))).status).toBe(403);
    expect((await api().post('/api/admin/movies').set(bearer(customer.token)).send({})).status).toBe(403);
    expect((await api().delete('/api/admin/shows/1').set(bearer(customer.token))).status).toBe(403);
    expect((await api().get('/api/admin/shows').set(bearer(admin.token))).status).toBe(200);
  });
});
