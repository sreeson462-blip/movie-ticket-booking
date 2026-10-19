import crypto from 'crypto';
import type { PoolClient } from 'pg';
import { config } from '../config';
import { Db, PG, isPgError, one, pool, rows, withTx } from '../db';
import { broadcastSeats } from '../events';
import { HttpError } from '../errors';
import { OCCUPYING_BOOKING_SQL, Seat, seatLabel } from './seats';
import { UPCOMING_THEN_PAST_ORDER } from './views';

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

const BOOKING_SELECT = `
  SELECT b.id, b.user_id, b.status, b.amount, b.created_at, b.confirmed_at, b.cancelled_at, b.hold_expires_at,
         s.id AS show_id, s.starts_at, s.ends_at, s.price,
         m.id AS movie_id, m.title, m.poster_url, m.language, m.rating,
         (SELECT array_agg(bs.row_label || bs.seat_number::text ORDER BY bs.row_label, bs.seat_number)
            FROM booking_seats bs WHERE bs.booking_id = b.id) AS seats
  FROM bookings b
  JOIN shows s ON s.id = b.show_id
  JOIN movies m ON m.id = s.movie_id`;

function toBookingView(r: any) {
  const msUntilShow = new Date(r.starts_at).getTime() - Date.now();
  return {
    id: r.id,
    status: r.status as 'held' | 'confirmed' | 'cancelled' | 'expired' | 'released',
    amount: r.amount,
    seats: r.seats as string[],
    createdAt: r.created_at,
    confirmedAt: r.confirmed_at,
    cancelledAt: r.cancelled_at,
    holdExpiresAt: r.status === 'held' ? r.hold_expires_at : null,
    canCancel: r.status === 'confirmed' && msUntilShow >= config.cancelCutoffHours * 3_600_000,
    show: { id: r.show_id, startsAt: r.starts_at, endsAt: r.ends_at, price: r.price },
    movie: { id: r.movie_id, title: r.title, posterUrl: r.poster_url, language: r.language, rating: r.rating },
  };
}

export type BookingView = ReturnType<typeof toBookingView>;

export async function getBookingView(db: Db, bookingId: string, userId: number): Promise<BookingView> {
  // The user_id condition IS the access check: another user's booking looks exactly like a missing one.
  const row = await one(db, `${BOOKING_SELECT} WHERE b.id = $1 AND b.user_id = $2`, [bookingId, userId]);
  if (!row) throw new HttpError(404, 'Booking not found');
  return toBookingView(row);
}

export async function listUserBookings(userId: number): Promise<BookingView[]> {
  // Holds, expired holds and released holds are not "bookings" from the customer's point of view.
  const result = await rows(
    pool,
    `${BOOKING_SELECT} WHERE b.user_id = $1 AND b.status IN ('confirmed', 'cancelled')
     ORDER BY ${UPCOMING_THEN_PAST_ORDER}, b.created_at DESC`,
    [userId],
  );
  return result.map(toBookingView);
}

// ---------------------------------------------------------------------------------------------
// Hold expiry
// ---------------------------------------------------------------------------------------------

/**
 * Mark overdue holds as expired and free their seats. Returns the show ids that changed.
 * (Reads already ignore overdue holds, so this is housekeeping: it frees the unique-index slot
 * so the seat can be claimed again.)
 */
export async function expireStaleHolds(db: Db, showId?: number): Promise<number[]> {
  const result = await rows<{ show_id: number }>(
    db,
    `WITH expired AS (
       UPDATE bookings SET status = 'expired'
       WHERE status = 'held' AND hold_expires_at <= now() AND ($1::int IS NULL OR show_id = $1)
       RETURNING id, show_id
     ), freed AS (
       UPDATE booking_seats SET active = false WHERE booking_id IN (SELECT id FROM expired)
     )
     SELECT DISTINCT show_id FROM expired`,
    [showId ?? null],
  );
  return result.map((r) => r.show_id);
}

/** Background job: runs every few seconds so open seat maps update when a hold times out. */
export async function sweepExpiredHolds(): Promise<void> {
  try {
    const changed = await expireStaleHolds(pool);
    changed.forEach(broadcastSeats);
  } catch (err) {
    console.error('Hold sweep failed', err);
  }
}

// ---------------------------------------------------------------------------------------------
// Hold seats (flow 4)
// ---------------------------------------------------------------------------------------------

const newBookingId = () => `BK-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

async function findUnavailableSeats(showId: number, seats: Seat[]): Promise<string[]> {
  const taken = await rows<{ row_label: string; seat_number: number }>(
    pool,
    `SELECT bs.row_label, bs.seat_number FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
     WHERE bs.show_id = $1 AND bs.active AND ${OCCUPYING_BOOKING_SQL}`,
    [showId],
  );
  const wanted = new Set(seats.map(seatLabel));
  return taken.map((t) => `${t.row_label}${t.seat_number}`).filter((l) => wanted.has(l));
}

export async function holdSeats(userId: number, showId: number, seats: Seat[]) {
  try {
    const bookingId = await withTx(async (tx) => {
      const show = await one<{ price: number; started: boolean }>(
        tx,
        'SELECT price, starts_at <= now() AS started FROM shows WHERE id = $1',
        [showId],
      );
      if (!show) throw new HttpError(404, 'Show not found');
      if (show.started) throw new HttpError(409, 'This show has already started.');

      // 1. Free seats whose hold ran out (lets those seats be claimed again).
      await expireStaleHolds(tx, showId);

      // 2. A user has one active hold per show: picking new seats replaces the old selection.
      await tx.query(
        `WITH released AS (
           UPDATE bookings SET status = 'released'
           WHERE user_id = $1 AND show_id = $2 AND status = 'held' RETURNING id
         )
         UPDATE booking_seats SET active = false WHERE booking_id IN (SELECT id FROM released)`,
        [userId, showId],
      );

      // 3. Claim the seats. If anyone else holds/booked one of them, the partial UNIQUE index
      //    makes this INSERT fail (or wait for the other transaction, then fail) - atomically.
      const id = newBookingId();
      await tx.query(
        `INSERT INTO bookings (id, user_id, show_id, status, amount, hold_expires_at)
         VALUES ($1, $2, $3, 'held', $4, now() + make_interval(mins => $5))`,
        [id, userId, showId, show.price * seats.length, config.holdMinutes],
      );
      const values = seats.map((_, i) => `($1, $2, $${i * 2 + 3}, $${i * 2 + 4})`).join(', ');
      await tx.query(
        `INSERT INTO booking_seats (booking_id, show_id, row_label, seat_number) VALUES ${values}`,
        [id, showId, ...seats.flatMap((s) => [s.row, s.number])],
      );
      return id;
    });

    broadcastSeats(showId);
    return getBookingView(pool, bookingId, userId);
  } catch (err) {
    if (isPgError(err, PG.UNIQUE_VIOLATION) || isPgError(err, PG.DEADLOCK)) {
      const conflictingSeats = await findUnavailableSeats(showId, seats);
      const message = conflictingSeats.length
        ? `Seat${conflictingSeats.length > 1 ? 's' : ''} ${conflictingSeats.join(', ')} ${
            conflictingSeats.length > 1 ? 'were' : 'was'
          } just taken by someone else. Please choose different seats.`
        : 'Those seats could not be reserved right now. Please try again.';
      broadcastSeats(showId);
      throw new HttpError(409, message, { conflictingSeats });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// Release a hold voluntarily (user clicked "change seats")
// ---------------------------------------------------------------------------------------------

export async function releaseHold(userId: number, bookingId: string): Promise<void> {
  const showId = await withTx(async (tx) => {
    const b = await one<{ show_id: number; status: string }>(
      tx,
      'SELECT show_id, status FROM bookings WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [bookingId, userId],
    );
    if (!b) throw new HttpError(404, 'Booking not found');
    if (b.status !== 'held') return null; // already confirmed / expired: nothing to release
    await tx.query(`UPDATE bookings SET status = 'released' WHERE id = $1`, [bookingId]);
    await tx.query('UPDATE booking_seats SET active = false WHERE booking_id = $1', [bookingId]);
    return b.show_id;
  });
  if (showId) broadcastSeats(showId);
}

// ---------------------------------------------------------------------------------------------
// Pay (flow 5)
// ---------------------------------------------------------------------------------------------

export type PaymentOutcome = 'success' | 'failure';

type PayResult =
  | { kind: 'confirmed'; showId: number }
  | { kind: 'payment_failed'; holdExpiresAt: Date }
  | { kind: 'expired'; showId: number };

export async function payForBooking(userId: number, bookingId: string, outcome: PaymentOutcome) {
  const result = await withTx<PayResult>(async (tx) => {
    // Row lock: two simultaneous "pay" clicks on the same booking are processed one after the other.
    const b = await one<{ show_id: number; status: string; amount: number; live: boolean; hold_expires_at: Date; started: boolean }>(
      tx,
      `SELECT b.show_id, b.status, b.amount, b.hold_expires_at, (b.hold_expires_at > now()) AS live,
              (s.starts_at <= now()) AS started
       FROM bookings b JOIN shows s ON s.id = b.show_id
       WHERE b.id = $1 AND b.user_id = $2 FOR UPDATE OF b`,
      [bookingId, userId],
    );
    if (!b) throw new HttpError(404, 'Booking not found');
    if (b.status === 'confirmed') throw new HttpError(409, 'This booking is already confirmed.');
    if (b.status === 'cancelled') throw new HttpError(409, 'This booking was cancelled.');

    if (b.status !== 'held' || !b.live || b.started) {
      // The hold ran out (or was replaced). Free the seats and report it. We COMMIT this cleanup.
      if (b.status === 'held') {
        await tx.query(`UPDATE bookings SET status = 'expired' WHERE id = $1`, [bookingId]);
        await tx.query('UPDATE booking_seats SET active = false WHERE booking_id = $1', [bookingId]);
      }
      return { kind: 'expired', showId: b.show_id };
    }

    if (outcome === 'failure') {
      await tx.query(`INSERT INTO payments (booking_id, status, amount) VALUES ($1, 'failed', $2)`, [bookingId, b.amount]);
      // Seats stay held until the original expiry so the customer can retry.
      return { kind: 'payment_failed', holdExpiresAt: b.hold_expires_at };
    }

    await tx.query(`INSERT INTO payments (booking_id, status, amount) VALUES ($1, 'success', $2)`, [bookingId, b.amount]);
    await tx.query(`UPDATE bookings SET status = 'confirmed', confirmed_at = now() WHERE id = $1`, [bookingId]);
    return { kind: 'confirmed', showId: b.show_id };
  });

  if (result.kind === 'expired') {
    broadcastSeats(result.showId);
    throw new HttpError(410, 'Your seat hold expired, so this payment was not accepted. Please select your seats again.', {
      code: 'HOLD_EXPIRED',
    });
  }
  if (result.kind === 'payment_failed') {
    throw new HttpError(402, 'Payment failed. Your seats are still held, so you can try again.', {
      code: 'PAYMENT_FAILED',
      holdExpiresAt: result.holdExpiresAt,
    });
  }
  broadcastSeats(result.showId);
  return getBookingView(pool, bookingId, userId);
}

// ---------------------------------------------------------------------------------------------
// Cancel (flow 8)
// ---------------------------------------------------------------------------------------------

export async function cancelBooking(userId: number, bookingId: string) {
  const showId = await withTx(async (tx: PoolClient) => {
    const b = await one<{ show_id: number; status: string; starts_at: Date; msUntil: number }>(
      tx,
      `SELECT b.show_id, b.status, s.starts_at,
              (extract(epoch FROM (s.starts_at - now())) * 1000)::float8 AS "msUntil"
       FROM bookings b JOIN shows s ON s.id = b.show_id
       WHERE b.id = $1 AND b.user_id = $2 FOR UPDATE OF b`,
      [bookingId, userId],
    );
    if (!b) throw new HttpError(404, 'Booking not found');
    if (b.status === 'cancelled') throw new HttpError(409, 'This booking is already cancelled.');
    if (b.status !== 'confirmed') throw new HttpError(409, 'Only confirmed bookings can be cancelled.');
    if (b.msUntil <= 0) throw new HttpError(409, 'This show has already started, so the booking cannot be cancelled.');
    if (b.msUntil < config.cancelCutoffHours * 3_600_000) {
      throw new HttpError(
        409,
        `Bookings can only be cancelled up to ${config.cancelCutoffHours} hours before the show starts.`,
      );
    }
    await tx.query(`UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [bookingId]);
    // Seats become available again immediately (frees the unique-index slot).
    await tx.query('UPDATE booking_seats SET active = false WHERE booking_id = $1', [bookingId]);
    return b.show_id;
  });
  broadcastSeats(showId);
  return getBookingView(pool, bookingId, userId);
}
