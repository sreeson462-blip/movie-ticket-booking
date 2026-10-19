import { TOTAL_SEATS } from '../config';
import { OCCUPYING_BOOKING_SQL } from './seats';

/** SELECT list shared by every query that returns a show with its movie and seats left. */
export const SHOW_COLUMNS = `
  s.id AS show_id, s.starts_at, s.ends_at, s.price,
  m.id AS movie_id, m.title, m.poster_url, m.language, m.rating, m.duration_minutes, m.description,
  ${TOTAL_SEATS} - (
    SELECT count(*) FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
    WHERE bs.show_id = s.id AND bs.active AND ${OCCUPYING_BOOKING_SQL}
  )::int AS available_seats`;

export const toMovie = (r: any) => ({
  id: r.id,
  title: r.title,
  description: r.description,
  language: r.language,
  durationMinutes: r.duration_minutes,
  rating: r.rating,
  posterUrl: r.poster_url,
});

export const toShow = (r: any) => ({
  id: r.show_id,
  movieId: r.movie_id,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  price: r.price,
  availableSeats: r.available_seats,
  totalSeats: TOTAL_SEATS,
});

export const toShowWithMovie = (r: any) => ({
  ...toShow(r),
  movie: {
    id: r.movie_id,
    title: r.title,
    posterUrl: r.poster_url,
    language: r.language,
    rating: r.rating,
    durationMinutes: r.duration_minutes,
  },
});

/** Upcoming shows first (soonest first), then past shows (most recent first). */
export const UPCOMING_THEN_PAST_ORDER = `
  (s.starts_at < now()),
  CASE WHEN s.starts_at >= now() THEN s.starts_at END ASC,
  CASE WHEN s.starts_at < now() THEN s.starts_at END DESC`;
