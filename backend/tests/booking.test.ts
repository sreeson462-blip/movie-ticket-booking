import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db';
import { resetDatabase } from '../src/migrate';
import { expireStaleHolds } from '../src/services/bookings';
import { api, bearer, expireHold, hold, hoursFromNow, insertMovie, insertShow, pay, seatMap, signup, statusOf } from './helpers';

let showId: number;
let movieId: number;

beforeEach(async () => {
  await resetDatabase();
  movieId = await insertMovie();
  showId = await insertShow(movieId, hoursFromNow(24), 200);
});
afterAll(() => pool.end());

const activeClaims = async (label: string) => {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM booking_seats WHERE show_id = $1 AND row_label || seat_number::text = $2 AND active`,
    [showId, label],
  );
  return rows[0].n as number;
};

describe('NO DOUBLE BOOKING (flows 4 and 5)', () => {
  it('two users holding the same seat at the same moment: exactly one succeeds', async () => {
    const [a, b] = await Promise.all([signup('A'), signup('B')]);
    const results = await Promise.all([hold(a.token, showId, ['C4']), hold(b.token, showId, ['C4'])]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body.conflictingSeats).toEqual(['C4']);
    expect(loser.body.error).toMatch(/C4/);
    expect(await activeClaims('C4')).toBe(1); // the database holds exactly one claim
  });

  it('25 users racing for one seat: exactly one wins', async () => {
    const users = await Promise.all(Array.from({ length: 25 }, (_, i) => signup(`U${i}`)));
    const results = await Promise.all(users.map((u) => hold(u.token, showId, ['H10'])));

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(24);
    expect(await activeClaims('H10')).toBe(1);
  });

  it('overlapping multi-seat requests never share a seat and never deadlock into a 500', async () => {
    const users = await Promise.all(Array.from({ length: 12 }, (_, i) => signup(`M${i}`)));
    const pool6 = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'];
    const picks = users.map((_, i) => [pool6[i % 6], pool6[(i + 1) % 6], pool6[(i + 3) % 6]]);
    const results = await Promise.all(users.map((u, i) => hold(u.token, showId, picks[i])));

    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    const won = results.filter((r) => r.status === 201).flatMap((r) => r.body.booking.seats as string[]);
    expect(new Set(won).size).toBe(won.length); // no seat appears in two successful holds
    expect(won.length).toBeGreaterThan(0);
  });

  it('a user whose hold expired cannot pay for a seat that someone else has since taken', async () => {
    const [a, b] = await Promise.all([signup('A'), signup('B')]);
    const first = await hold(a.token, showId, ['D5']);
    expect(first.status).toBe(201);

    await expireHold(first.body.booking.id); // A's 5 minutes run out (no cleanup job ran yet)

    const second = await hold(b.token, showId, ['D5']); // B can take the seat immediately
    expect(second.status).toBe(201);

    const latePay = await pay(a.token, first.body.booking.id, 'success');
    expect(latePay.status).toBe(410);
    expect(latePay.body.code).toBe('HOLD_EXPIRED');

    const bPay = await pay(b.token, second.body.booking.id, 'success');
    expect(bPay.status).toBe(200);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM bookings WHERE show_id = $1 AND status = 'confirmed'`, [showId]);
    expect(rows[0].n).toBe(1);
  });

  it('two simultaneous "pay" requests for one booking confirm it only once', async () => {
    const a = await signup('A');
    const h = await hold(a.token, showId, ['A1', 'A2']);
    const results = await Promise.all([pay(a.token, h.body.booking.id), pay(a.token, h.body.booking.id)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM payments WHERE booking_id = $1 AND status = 'success'`, [h.body.booking.id]);
    expect(rows[0].n).toBe(1);
  });

  it('the database itself refuses a second active claim on a seat (no app code involved)', async () => {
    const a = await signup('A');
    const h = await hold(a.token, showId, ['E1']);
    expect(h.status).toBe(201);
    await pool.query(
      `INSERT INTO bookings (id, user_id, show_id, status, amount, hold_expires_at) VALUES ('BK-RAW', $1, $2, 'held', 200, now() + interval '5 minutes')`,
      [a.user.id, showId],
    );
    await expect(
      pool.query(`INSERT INTO booking_seats (booking_id, show_id, row_label, seat_number) VALUES ('BK-RAW', $1, 'E', 1)`, [showId]),
    ).rejects.toMatchObject({ code: '23505' });
  });
});

describe('flow 4: select and hold', () => {
  it('holds 1 to 6 seats, rejects the 7th, rejects invalid seats', async () => {
    const a = await signup();
    expect((await hold(a.token, showId, ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'])).status).toBe(201);
    const seven = await hold(a.token, showId, ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7']);
    expect(seven.status).toBe(400);
    expect(seven.body.error).toMatch(/at most 6/);
    expect((await hold(a.token, showId, [])).status).toBe(400);
    expect((await hold(a.token, showId, ['I1'])).status).toBe(400);
    expect((await hold(a.token, showId, ['A11'])).status).toBe(400);
  });

  it('charges seats x price and returns a hold expiry about 5 minutes away', async () => {
    const a = await signup();
    const res = await hold(a.token, showId, ['C4', 'C5']);
    expect(res.body.booking.amount).toBe(400);
    expect(res.body.booking.seats).toEqual(['C4', 'C5']);
    const ms = new Date(res.body.booking.holdExpiresAt).getTime() - Date.now();
    expect(ms).toBeGreaterThan(4.5 * 60_000);
    expect(ms).toBeLessThanOrEqual(5 * 60_000);
  });

  it('picking new seats replaces the same user\'s earlier hold for that show', async () => {
    const a = await signup();
    await hold(a.token, showId, ['A1']);
    const again = await hold(a.token, showId, ['A2']);
    expect(again.status).toBe(201);
    const map = (await seatMap(showId, a.token)).body;
    expect(statusOf(map, 'A1')).toBe('available');
    expect(statusOf(map, 'A2')).toBe('held');
    expect(map.myHold.seats).toEqual(['A2']);
  });

  it('seats become available again for everyone when the hold runs out', async () => {
    const [a, b] = await Promise.all([signup('A'), signup('B')]);
    const h = await hold(a.token, showId, ['F6']);
    expect(statusOf((await seatMap(showId, b.token)).body, 'F6')).toBe('held');
    expect((await hold(b.token, showId, ['F6'])).status).toBe(409);

    await expireHold(h.body.booking.id);
    // Visible immediately (reads ignore overdue holds) ...
    expect(statusOf((await seatMap(showId, b.token)).body, 'F6')).toBe('available');
    // ... and the housekeeping job also marks the hold expired.
    expect(await expireStaleHolds(pool)).toEqual([showId]);
    const { rows } = await pool.query('SELECT status FROM bookings WHERE id = $1', [h.body.booking.id]);
    expect(rows[0].status).toBe('expired');
  });
});

describe('flow 3: seat map and flow 2: shows', () => {
  it('returns 80 seats in three states and marks only my own hold as mine', async () => {
    const [a, b] = await Promise.all([signup('A'), signup('B')]);
    const mine = await hold(a.token, showId, ['A1']);
    await pay(b.token, (await hold(b.token, showId, ['A2'])).body.booking.id);
    await hold(b.token, showId, ['A3']).then(async () => {
      // B replaced nothing: A2 is confirmed, now B holds A3 as well
    });

    const asA = (await seatMap(showId, a.token)).body;
    expect(asA.seats).toHaveLength(80);
    expect(statusOf(asA, 'A1')).toBe('held');
    expect(asA.seats.find((s: any) => s.label === 'A1').mine).toBe(true);
    expect(statusOf(asA, 'A2')).toBe('booked');
    expect(statusOf(asA, 'A3')).toBe('held');
    expect(asA.seats.find((s: any) => s.label === 'A3').mine).toBe(false);
    expect(statusOf(asA, 'A4')).toBe('available');
    expect(mine.status).toBe(201);
  });

  it('lists only upcoming shows, with seats left', async () => {
    await insertShow(movieId, new Date(Date.now() - 3 * 3_600_000)); // already started
    const a = await signup();
    await hold(a.token, showId, ['A1', 'A2']);
    const res = await api().get(`/api/movies/${movieId}`);
    expect(res.status).toBe(200);
    expect(res.body.shows).toHaveLength(1);
    expect(res.body.shows[0]).toMatchObject({ id: showId, price: 200, availableSeats: 78 });
  });

  it('refuses to hold seats for a show that already started', async () => {
    const past = await insertShow(movieId, new Date(Date.now() - 3 * 3_600_000));
    const a = await signup();
    const res = await hold(a.token, past, ['A1']);
    expect(res.status).toBe(409);
  });
});

describe('flow 5: pay and confirm', () => {
  it('payment success confirms the booking and books the seats', async () => {
    const a = await signup();
    const h = await hold(a.token, showId, ['C4', 'C5']);
    const res = await pay(a.token, h.body.booking.id, 'success');
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ status: 'confirmed', amount: 400, seats: ['C4', 'C5'] });
    expect(res.body.booking.id).toMatch(/^BK-[0-9A-F]{10}$/);
    expect(statusOf((await seatMap(showId)).body, 'C4')).toBe('booked');
  });

  it('payment failure creates no booking, keeps the hold, and allows a retry', async () => {
    const a = await signup();
    const h = await hold(a.token, showId, ['C4']);
    const failed = await pay(a.token, h.body.booking.id, 'failure');
    expect(failed.status).toBe(402);
    expect(failed.body.error).toMatch(/Payment failed/);
    expect((await api().get('/api/bookings').set(bearer(a.token))).body.bookings).toHaveLength(0);
    expect(statusOf((await seatMap(showId, a.token)).body, 'C4')).toBe('held');

    const retry = await pay(a.token, h.body.booking.id, 'success');
    expect(retry.status).toBe(200);
    expect(retry.body.booking.status).toBe('confirmed');
  });

  it('rejects payment after the hold expired, and frees the seats', async () => {
    const a = await signup();
    const h = await hold(a.token, showId, ['C4']);
    await expireHold(h.body.booking.id);
    const res = await pay(a.token, h.body.booking.id, 'success');
    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/expired/i);
    expect(statusOf((await seatMap(showId)).body, 'C4')).toBe('available');
  });

  it('rejects a payment outcome that is not success or failure', async () => {
    const a = await signup();
    const h = await hold(a.token, showId, ['C4']);
    const res = await api().post(`/api/bookings/${h.body.booking.id}/pay`).set(bearer(a.token)).send({ outcome: 'free' });
    expect(res.status).toBe(400);
  });

  it('a user cannot pay for someone else\'s hold', async () => {
    const [a, b] = await Promise.all([signup('A'), signup('B')]);
    const h = await hold(a.token, showId, ['C4']);
    expect((await pay(b.token, h.body.booking.id)).status).toBe(404);
  });
});

describe('flow 6: my bookings', () => {
  it('shows only my bookings, upcoming first then past, and hides other users\' bookings by id', async () => {
    const [a, b] = await Promise.all([signup('A'), signup('B')]);
    const later = await insertShow(movieId, hoursFromNow(72), 100);
    const past = await insertShow(movieId, new Date(Date.now() - 6 * 3_600_000), 100);

    // A past booking can only exist via SQL: create it as a confirmed booking directly.
    await pool.query(
      `INSERT INTO bookings (id, user_id, show_id, status, amount, hold_expires_at, confirmed_at)
       VALUES ('BK-PAST000001', $1, $2, 'confirmed', 100, now(), now())`,
      [a.user.id, past],
    );
    await pool.query(`INSERT INTO booking_seats (booking_id, show_id, row_label, seat_number) VALUES ('BK-PAST000001', $1, 'A', 1)`, [past]);

    const soonBooking = (await pay(a.token, (await hold(a.token, showId, ['B1'])).body.booking.id)).body.booking;
    const laterBooking = (await pay(a.token, (await hold(a.token, later, ['B2'])).body.booking.id)).body.booking;
    const bBooking = (await pay(b.token, (await hold(b.token, showId, ['B3'])).body.booking.id)).body.booking;

    const list = (await api().get('/api/bookings').set(bearer(a.token))).body.bookings;
    expect(list.map((x: any) => x.id)).toEqual([soonBooking.id, laterBooking.id, 'BK-PAST000001']);
    expect(list[0]).toMatchObject({ seats: ['B1'], amount: 200, status: 'confirmed' });
    expect(list[0].movie.title).toBe('Test Movie');

    // Changing the id in the URL / API call never reveals another user's booking.
    expect((await api().get(`/api/bookings/${bBooking.id}`).set(bearer(a.token))).status).toBe(404);
    expect((await api().get(`/api/bookings/${soonBooking.id}`).set(bearer(a.token))).status).toBe(200);
    expect((await api().post(`/api/bookings/${bBooking.id}/cancel`).set(bearer(a.token))).status).toBe(404);
  });
});

describe('flow 8: cancel a booking', () => {
  it('cancels a booking more than 2 hours before the show and frees the seats immediately', async () => {
    const a = await signup();
    const booked = (await pay(a.token, (await hold(a.token, showId, ['G1', 'G2'])).body.booking.id)).body.booking;
    expect(booked.canCancel).toBe(true);

    const res = await api().post(`/api/bookings/${booked.id}/cancel`).set(bearer(a.token));
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('cancelled');
    const map = (await seatMap(showId)).body;
    expect(statusOf(map, 'G1')).toBe('available');
    expect(statusOf(map, 'G2')).toBe('available');

    const b = await signup('B');
    expect((await hold(b.token, showId, ['G1'])).status).toBe(201); // someone else can now take it
    expect((await api().post(`/api/bookings/${booked.id}/cancel`).set(bearer(a.token))).status).toBe(409); // not twice
  });

  it('rejects cancelling within 2 hours of the show, and for past shows', async () => {
    const a = await signup();
    const soon = await insertShow(movieId, hoursFromNow(1), 100); // starts in 1 hour: inside the cutoff
    const booked = (await pay(a.token, (await hold(a.token, soon, ['A1'])).body.booking.id)).body.booking;
    expect(booked.canCancel).toBe(false);
    const res = await api().post(`/api/bookings/${booked.id}/cancel`).set(bearer(a.token));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/2 hours/);

    await pool.query(`UPDATE shows SET starts_at = now() - interval '4 hours', ends_at = now() - interval '2 hours' WHERE id = $1`, [soon]);
    const past = await api().post(`/api/bookings/${booked.id}/cancel`).set(bearer(a.token));
    expect(past.status).toBe(409);
    expect(past.body.error).toMatch(/already started/);
  });
});
