import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth';
import { ROWS, SEATS_PER_ROW, TOTAL_SEATS } from '../config';
import { PG, isPgError, one, pool, rows, withTx } from '../db';
import { broadcastSeats } from '../events';
import { HttpError } from '../errors';
import { OCCUPYING_BOOKING_SQL } from '../services/seats';
import { UPCOMING_THEN_PAST_ORDER, toMovie } from '../services/views';

export const adminRouter = Router();
adminRouter.use(requireAdmin); // 401 when logged out, 403 for customers

const idParam = (value: unknown, what: string) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, `${what} not found`);
  return id;
};

// ---- Movies (flow 7) -----------------------------------------------------------------------

const movieSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().max(2000).default(''),
  language: z.string().trim().min(1, 'Language is required').max(50),
  durationMinutes: z.coerce.number().int('Duration must be a whole number').min(1).max(600, 'Duration must be 600 minutes or less'),
  rating: z.enum(['U', 'UA', 'A']),
  posterUrl: z
    .string()
    .trim()
    .max(2000)
    .url('Poster must be a valid URL')
    .optional()
    .or(z.literal(''))
    .transform((v) => v || null),
});

adminRouter.post('/movies', async (req, res) => {
  const m = movieSchema.parse(req.body);
  const movie = await one(
    pool,
    `INSERT INTO movies (title, description, language, duration_minutes, rating, poster_url)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [m.title, m.description, m.language, m.durationMinutes, m.rating, m.posterUrl],
  );
  res.status(201).json({ movie: toMovie(movie) });
});

adminRouter.put('/movies/:id', async (req, res) => {
  const id = idParam(req.params.id, 'Movie');
  const m = movieSchema.parse(req.body);
  try {
    const movie = await withTx(async (tx) => {
      const updated = await one(
        tx,
        `UPDATE movies SET title=$2, description=$3, language=$4, duration_minutes=$5, rating=$6, poster_url=$7
         WHERE id = $1 RETURNING *`,
        [id, m.title, m.description, m.language, m.durationMinutes, m.rating, m.posterUrl],
      );
      if (!updated) throw new HttpError(404, 'Movie not found');
      // A show's end time is start + duration, so a new duration moves every show's end time.
      await tx.query(`UPDATE shows SET ends_at = starts_at + make_interval(mins => $2) WHERE movie_id = $1`, [id, m.durationMinutes]);
      return updated;
    });
    res.json({ movie: toMovie(movie) });
  } catch (err) {
    if (isPgError(err, PG.EXCLUSION_VIOLATION)) {
      throw new HttpError(409, 'With this duration, one of the movie\'s shows would overlap the next show on the screen.');
    }
    throw err;
  }
});

adminRouter.delete('/movies/:id', async (req, res) => {
  const id = idParam(req.params.id, 'Movie');
  try {
    await withTx(async (tx) => {
      // Drop abandoned holds first; confirmed/cancelled bookings are real history and block deletion (FK RESTRICT).
      await tx.query(
        `DELETE FROM bookings WHERE status IN ('held','expired','released') AND show_id IN (SELECT id FROM shows WHERE movie_id = $1)`,
        [id],
      );
      await tx.query('DELETE FROM shows WHERE movie_id = $1', [id]);
      const deleted = await one(tx, 'DELETE FROM movies WHERE id = $1 RETURNING id', [id]);
      if (!deleted) throw new HttpError(404, 'Movie not found');
    });
    res.status(204).end();
  } catch (err) {
    if (isPgError(err, PG.FK_VIOLATION)) {
      throw new HttpError(409, 'This movie has shows with bookings, so it cannot be deleted.');
    }
    throw err;
  }
});

// ---- Shows (flow 7) ------------------------------------------------------------------------

const showSchema = z.object({
  movieId: z.coerce.number().int().positive(),
  startsAt: z.string().datetime({ offset: true, message: 'Enter a valid date and time' }),
  price: z.coerce.number().int('Price must be a whole number').min(0).max(100000),
});

const OVERLAP_MESSAGE =
  'This show overlaps another show on the screen. A show occupies the screen from its start time until start + movie duration.';

adminRouter.post('/shows', async (req, res) => {
  const s = showSchema.parse(req.body);
  if (new Date(s.startsAt).getTime() <= Date.now()) throw new HttpError(400, 'A new show must start in the future.');
  try {
    const show = await one(
      pool,
      `INSERT INTO shows (movie_id, starts_at, ends_at, price)
       SELECT m.id, $2::timestamptz, $2::timestamptz + make_interval(mins => m.duration_minutes), $3
       FROM movies m WHERE m.id = $1
       RETURNING id, movie_id, starts_at, ends_at, price`,
      [s.movieId, s.startsAt, s.price],
    );
    if (!show) throw new HttpError(404, 'Movie not found');
    res.status(201).json({ show: { id: show.id, movieId: show.movie_id, startsAt: show.starts_at, endsAt: show.ends_at, price: show.price } });
  } catch (err) {
    if (isPgError(err, PG.EXCLUSION_VIOLATION)) throw new HttpError(409, OVERLAP_MESSAGE);
    throw err;
  }
});

adminRouter.put('/shows/:id', async (req, res) => {
  const id = idParam(req.params.id, 'Show');
  const s = showSchema.parse(req.body);
  try {
    const show = await withTx(async (tx) => {
      const current = await one<{ movie_id: number; starts_at: Date }>(tx, 'SELECT movie_id, starts_at FROM shows WHERE id = $1 FOR UPDATE', [id]);
      if (!current) throw new HttpError(404, 'Show not found');
      const timeOrMovieChanged = current.movie_id !== s.movieId || current.starts_at.getTime() !== new Date(s.startsAt).getTime();
      if (timeOrMovieChanged) {
        const hasBookings = await one(tx, `SELECT 1 FROM bookings WHERE show_id = $1 AND status IN ('confirmed','cancelled') LIMIT 1`, [id]);
        if (hasBookings) throw new HttpError(409, 'This show already has bookings, so only its price can be changed.');
      }
      const updated = await one(
        tx,
        `UPDATE shows SET movie_id = m.id, starts_at = $2::timestamptz,
                ends_at = $2::timestamptz + make_interval(mins => m.duration_minutes), price = $3
         FROM movies m WHERE shows.id = $4 AND m.id = $1
         RETURNING shows.id, shows.movie_id, shows.starts_at, shows.ends_at, shows.price`,
        [s.movieId, s.startsAt, s.price, id],
      );
      if (!updated) throw new HttpError(404, 'Movie not found');
      return updated;
    });
    res.json({ show: { id: show.id, movieId: show.movie_id, startsAt: show.starts_at, endsAt: show.ends_at, price: show.price } });
  } catch (err) {
    if (isPgError(err, PG.EXCLUSION_VIOLATION)) throw new HttpError(409, OVERLAP_MESSAGE);
    throw err;
  }
});

adminRouter.delete('/shows/:id', async (req, res) => {
  const id = idParam(req.params.id, 'Show');
  try {
    await withTx(async (tx) => {
      await tx.query(`DELETE FROM bookings WHERE show_id = $1 AND status IN ('held','expired','released')`, [id]);
      const deleted = await one(tx, 'DELETE FROM shows WHERE id = $1 RETURNING id', [id]); // FK RESTRICT blocks real bookings
      if (!deleted) throw new HttpError(404, 'Show not found');
    });
    broadcastSeats(id);
    res.status(204).end();
  } catch (err) {
    if (isPgError(err, PG.FK_VIOLATION)) {
      throw new HttpError(409, 'This show already has bookings, so it cannot be deleted.');
    }
    throw err;
  }
});

// ---- Flow 9: per-show occupancy, revenue and booking list -----------------------------------

adminRouter.get('/shows', async (_req, res) => {
  const list = await rows(
    pool,
    `SELECT s.id, s.starts_at, s.ends_at, s.price, m.id AS movie_id, m.title, m.language, m.rating,
       (SELECT count(*) FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
         WHERE bs.show_id = s.id AND bs.active AND b.status = 'confirmed')::int AS booked_seats,
       (SELECT count(*) FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
         WHERE bs.show_id = s.id AND bs.active AND ${OCCUPYING_BOOKING_SQL} AND b.status = 'held')::int AS held_seats,
       (SELECT COALESCE(sum(b.amount), 0) FROM bookings b WHERE b.show_id = s.id AND b.status = 'confirmed')::int AS revenue,
       (SELECT count(*) FROM bookings b WHERE b.show_id = s.id AND b.status IN ('confirmed','cancelled'))::int AS booking_records,
       (s.starts_at < now()) AS past
     FROM shows s JOIN movies m ON m.id = s.movie_id
     ORDER BY ${UPCOMING_THEN_PAST_ORDER}`,
  );
  res.json({
    shows: list.map((r) => ({
      id: r.id,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      price: r.price,
      past: r.past,
      movie: { id: r.movie_id, title: r.title, language: r.language, rating: r.rating },
      bookedSeats: r.booked_seats,
      heldSeats: r.held_seats,
      totalSeats: TOTAL_SEATS,
      percentFull: Math.round((r.booked_seats / TOTAL_SEATS) * 1000) / 10,
      revenue: r.revenue,
      hasBookings: r.booking_records > 0,
    })),
  });
});

adminRouter.get('/shows/:id/bookings', async (req, res) => {
  const id = idParam(req.params.id, 'Show');
  const show = await one(
    pool,
    `SELECT s.id, s.starts_at, s.price, m.title FROM shows s JOIN movies m ON m.id = s.movie_id WHERE s.id = $1`,
    [id],
  );
  if (!show) throw new HttpError(404, 'Show not found');
  const list = await rows(
    pool,
    `SELECT b.id, b.status, b.amount, b.created_at, b.confirmed_at, b.cancelled_at, u.name AS customer_name, u.email AS customer_email,
            (SELECT array_agg(bs.row_label || bs.seat_number::text ORDER BY bs.row_label, bs.seat_number)
               FROM booking_seats bs WHERE bs.booking_id = b.id) AS seats
     FROM bookings b JOIN users u ON u.id = b.user_id
     WHERE b.show_id = $1 AND b.status IN ('confirmed','cancelled')
     ORDER BY b.created_at DESC`,
    [id],
  );
  res.json({
    show: { id: show.id, startsAt: show.starts_at, price: show.price, movieTitle: show.title, rows: ROWS.length, seatsPerRow: SEATS_PER_ROW },
    bookings: list.map((b) => ({
      id: b.id,
      status: b.status,
      amount: b.amount,
      seats: b.seats,
      bookedAt: b.confirmed_at ?? b.created_at,
      cancelledAt: b.cancelled_at,
      customerName: b.customer_name,
      customerEmail: b.customer_email,
    })),
  });
});
