import { ROWS, SEATS_PER_ROW, config } from '../config';
import { HttpError } from '../errors';

export interface Seat {
  row: string;
  number: number;
}

export const seatLabel = (s: Seat) => `${s.row}${s.number}`;

/**
 * Turn user input like ["c4", "C5"] into validated, de-duplicated seats sorted by row then number.
 * The sort order matters: every transaction inserts seats in the SAME order, which prevents
 * deadlocks when two people hold overlapping seat sets at the same time.
 */
export function parseSeats(labels: string[]): Seat[] {
  const seen = new Map<string, Seat>();
  for (const raw of labels) {
    const m = /^([A-Ha-h])(10|[1-9])$/.exec(raw.trim());
    if (!m) throw new HttpError(400, `"${raw}" is not a valid seat. Seats go from A1 to H${SEATS_PER_ROW}.`);
    const seat = { row: m[1].toUpperCase(), number: Number(m[2]) };
    seen.set(seatLabel(seat), seat);
  }
  const seats = [...seen.values()];
  if (seats.length === 0) throw new HttpError(400, 'Select at least 1 seat.');
  if (seats.length > config.maxSeatsPerBooking) {
    throw new HttpError(400, `You can book at most ${config.maxSeatsPerBooking} seats at a time.`);
  }
  return seats.sort((a, b) => ROWS.indexOf(a.row as never) - ROWS.indexOf(b.row as never) || a.number - b.number);
}

/**
 * SQL condition: "this booking currently occupies its seats".
 * Confirmed bookings always do; a hold only until it expires. Expiry is evaluated against the
 * DB clock at read time, so seats free up exactly on time even if no cleanup job has run yet.
 */
export const OCCUPYING_BOOKING_SQL = `(b.status = 'confirmed' OR (b.status = 'held' AND b.hold_expires_at > now()))`;
