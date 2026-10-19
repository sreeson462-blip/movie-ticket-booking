import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db';
import { resetDatabase } from '../src/migrate';
import { api, bearer, createAdmin, hold, hoursFromNow, insertMovie, insertShow, pay, signup } from './helpers';

let admin: string;

beforeEach(async () => {
  await resetDatabase();
  admin = (await createAdmin()).token;
});
afterAll(() => pool.end());

const movieBody = { title: 'New Movie', description: 'desc', language: 'Hindi', durationMinutes: 120, rating: 'UA', posterUrl: '' };
const post = (path: string, body: object) => api().post(`/api/admin${path}`).set(bearer(admin)).send(body);

describe('flow 7: admin movies and shows', () => {
  it('adds, edits and deletes a movie', async () => {
    const created = await post('/movies', movieBody);
    expect(created.status).toBe(201);
    const id = created.body.movie.id;
    expect(created.body.movie.posterUrl).toBeNull();

    const edited = await api().put(`/api/admin/movies/${id}`).set(bearer(admin)).send({ ...movieBody, title: 'Renamed', rating: 'A' });
    expect(edited.status).toBe(200);
    expect(edited.body.movie).toMatchObject({ title: 'Renamed', rating: 'A' });

    expect((await api().delete(`/api/admin/movies/${id}`).set(bearer(admin))).status).toBe(204);
    expect((await api().get(`/api/movies/${id}`)).status).toBe(404);
  });

  it('validates movie fields', async () => {
    expect((await post('/movies', { ...movieBody, rating: 'R' })).status).toBe(400);
    expect((await post('/movies', { ...movieBody, title: '  ' })).status).toBe(400);
    expect((await post('/movies', { ...movieBody, durationMinutes: 0 })).status).toBe(400);
  });

  it('adds a show and computes its end time from the movie duration', async () => {
    const movieId = (await post('/movies', movieBody)).body.movie.id;
    const startsAt = hoursFromNow(48).toISOString();
    const res = await post('/shows', { movieId, startsAt, price: 250 });
    expect(res.status).toBe(201);
    const ms = new Date(res.body.show.endsAt).getTime() - new Date(res.body.show.startsAt).getTime();
    expect(ms).toBe(120 * 60_000);
    expect((await post('/shows', { movieId, startsAt: new Date(Date.now() - 60_000).toISOString(), price: 100 })).status).toBe(400);
  });

  it('rejects overlapping shows on the single screen, but allows back-to-back shows', async () => {
    const movieId = (await post('/movies', movieBody)).body.movie.id; // 120 minutes
    const start = hoursFromNow(48);
    expect((await post('/shows', { movieId, startsAt: start.toISOString(), price: 200 })).status).toBe(201);

    const during = new Date(start.getTime() + 60 * 60_000); // starts 1h into the first show
    const overlapping = await post('/shows', { movieId, startsAt: during.toISOString(), price: 200 });
    expect(overlapping.status).toBe(409);
    expect(overlapping.body.error).toMatch(/overlaps/);

    const before = new Date(start.getTime() - 60 * 60_000); // would run into the first show
    expect((await post('/shows', { movieId, startsAt: before.toISOString(), price: 200 })).status).toBe(409);

    const backToBack = new Date(start.getTime() + 120 * 60_000); // starts exactly when the first ends
    expect((await post('/shows', { movieId, startsAt: backToBack.toISOString(), price: 200 })).status).toBe(201);
  });

  it('refuses to delete a show that has bookings, but deletes an empty one', async () => {
    const movieId = await insertMovie();
    const booked = await insertShow(movieId, hoursFromNow(24));
    const empty = await insertShow(movieId, hoursFromNow(48));
    const customer = await signup();
    await pay(customer.token, (await hold(customer.token, booked, ['A1'])).body.booking.id);

    const blocked = await api().delete(`/api/admin/shows/${booked}`).set(bearer(admin));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/bookings/);
    expect((await api().delete(`/api/admin/shows/${empty}`).set(bearer(admin))).status).toBe(204);

    // a show with only an abandoned hold can still be deleted
    const heldOnly = await insertShow(movieId, hoursFromNow(72));
    await hold(customer.token, heldOnly, ['B1']);
    expect((await api().delete(`/api/admin/shows/${heldOnly}`).set(bearer(admin))).status).toBe(204);
  });

  it('does not let the time of a booked show change', async () => {
    const movieId = await insertMovie();
    const showId = await insertShow(movieId, hoursFromNow(24), 200);
    const customer = await signup();
    await pay(customer.token, (await hold(customer.token, showId, ['A1'])).body.booking.id);
    const res = await api().put(`/api/admin/shows/${showId}`).set(bearer(admin)).send({ movieId, startsAt: hoursFromNow(30).toISOString(), price: 200 });
    expect(res.status).toBe(409);
  });
});

describe('flow 9: bookings per show', () => {
  it('reports seats booked out of 80, percent full, revenue and the booking list', async () => {
    const movieId = await insertMovie();
    const showId = await insertShow(movieId, hoursFromNow(24), 200);
    const [a, b] = await Promise.all([signup('Asha'), signup('Ravi')]);
    await pay(a.token, (await hold(a.token, showId, ['A1', 'A2', 'A3', 'A4'])).body.booking.id);
    await pay(b.token, (await hold(b.token, showId, ['B1', 'B2'])).body.booking.id);
    const cancelled = (await pay(b.token, (await hold(b.token, showId, ['C1'])).body.booking.id)).body.booking;
    await api().post(`/api/bookings/${cancelled.id}/cancel`).set(bearer(b.token));

    const stats = (await api().get('/api/admin/shows').set(bearer(admin))).body.shows.find((s: any) => s.id === showId);
    expect(stats).toMatchObject({ bookedSeats: 6, totalSeats: 80, percentFull: 7.5, revenue: 1200, hasBookings: true });

    const detail = (await api().get(`/api/admin/shows/${showId}/bookings`).set(bearer(admin))).body;
    const confirmed = detail.bookings.filter((x: any) => x.status === 'confirmed');
    expect(confirmed.map((x: any) => x.customerName).sort()).toEqual(['Asha', 'Ravi']);
    expect(confirmed.find((x: any) => x.customerName === 'Asha').seats).toEqual(['A1', 'A2', 'A3', 'A4']);
  });
});
