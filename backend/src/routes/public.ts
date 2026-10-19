import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth, requireAuth } from '../auth';
import { ROWS, SEATS_PER_ROW, TOTAL_SEATS } from '../config';
import { one, pool, rows } from '../db';
import { subscribe } from '../events';
import { HttpError } from '../errors';
import { holdSeats } from '../services/bookings';
import { OCCUPYING_BOOKING_SQL, parseSeats } from '../services/seats';
import { SHOW_COLUMNS, toMovie, toShow, toShowWithMovie } from '../services/views';

export const publicRouter = Router();

const idParam = (value: unknown, what = 'id') => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, `${what} not found`);
  return id;
};

// ---- Flow 2: browse movies and shows -------------------------------------------------------

publicRouter.get('/movies', async (_req, res) => {
  const list = await rows(
    pool,
    `SELECT m.*, (SELECT count(*) FROM shows s WHERE s.movie_id = m.id AND s.starts_at > now())::int AS upcoming_shows,
            (SELECT min(s.starts_at) FROM shows s WHERE s.movie_id = m.id AND s.starts_at > now()) AS next_show_at
     FROM movies m ORDER BY m.title`,
  );
  res.json({
    movies: list.map((r) => ({ ...toMovie(r), upcomingShows: r.upcoming_shows, nextShowAt: r.next_show_at })),
  });
});

publicRouter.get('/movies/:id', async (req, res) => {
  const id = idParam(req.params.id, 'Movie');
  const movie = await one(pool, 'SELECT * FROM movies WHERE id = $1', [id]);
  if (!movie) throw new HttpError(404, 'Movie not found');
  // Shows that have already started are never listed.
  const shows = await rows(
    pool,
    `SELECT ${SHOW_COLUMNS} FROM shows s JOIN movies m ON m.id = s.movie_id
     WHERE s.movie_id = $1 AND s.starts_at > now() ORDER BY s.starts_at`,
    [id],
  );
  res.json({ movie: toMovie(movie), shows: shows.map(toShow) });
});

// ---- Flow 3: seat map ----------------------------------------------------------------------

publicRouter.get('/shows/:id', async (req, res) => {
  const id = idParam(req.params.id, 'Show');
  const show = await one(pool, `SELECT ${SHOW_COLUMNS} FROM shows s JOIN movies m ON m.id = s.movie_id WHERE s.id = $1`, [id]);
  if (!show) throw new HttpError(404, 'Show not found');
  res.json({ show: toShowWithMovie(show) });
});

publicRouter.get('/shows/:id/seats', optionalAuth, async (req, res) => {
  const id = idParam(req.params.id, 'Show');
  const show = await one(
    pool,
    `SELECT ${SHOW_COLUMNS}, (s.starts_at <= now()) AS started
     FROM shows s JOIN movies m ON m.id = s.movie_id WHERE s.id = $1`,
    [id],
  );
  if (!show) throw new HttpError(404, 'Show not found');

  const claimed = await rows(
    pool,
    `SELECT bs.row_label, bs.seat_number, b.id AS booking_id, b.status, b.user_id, b.hold_expires_at, b.amount
     FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
     WHERE bs.show_id = $1 AND bs.active AND ${OCCUPYING_BOOKING_SQL}`,
    [id],
  );
  const byLabel = new Map(claimed.map((c) => [`${c.row_label}${c.seat_number}`, c]));
  const me = req.user?.id;

  const seats = ROWS.flatMap((row) =>
    Array.from({ length: SEATS_PER_ROW }, (_, i) => {
      const number = i + 1;
      const label = `${row}${number}`;
      const c = byLabel.get(label);
      const status = !c ? 'available' : c.status === 'confirmed' ? 'booked' : 'held';
      // "mine" is only ever true for the logged-in user's own live hold.
      return { row, number, label, status, mine: status === 'held' && c!.user_id === me };
    }),
  );

  const mine = claimed.filter((c) => c.status === 'held' && c.user_id === me);
  const myHold = mine.length
    ? {
        bookingId: mine[0].booking_id as string,
        expiresAt: mine[0].hold_expires_at as Date,
        amount: mine[0].amount as number,
        seats: mine.map((c) => `${c.row_label}${c.seat_number}`).sort(),
      }
    : null;

  res.json({
    show: { ...toShowWithMovie(show), started: show.started },
    seats,
    totalSeats: TOTAL_SEATS,
    myHold,
    serverTime: new Date(), // lets the browser correct its clock when showing the hold countdown
  });
});

// ---- Flow 10: live updates via Server-Sent Events -------------------------------------------

publicRouter.get('/shows/:id/events', async (req, res) => {
  const id = idParam(req.params.id, 'Show');
  subscribe(id, res);
});

// ---- Flow 4: hold seats --------------------------------------------------------------------

const holdSchema = z.object({ seats: z.array(z.string()).max(50) });

publicRouter.post('/shows/:id/hold', requireAuth, async (req, res) => {
  const id = idParam(req.params.id, 'Show');
  const { seats } = holdSchema.parse(req.body);
  const booking = await holdSeats(req.user!.id, id, parseSeats(seats));
  res.status(201).json({ booking });
});
