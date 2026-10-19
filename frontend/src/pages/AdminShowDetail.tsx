import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../api';
import SeatMap from '../components/SeatMap';
import { Notice, Spinner, StatusBadge } from '../components/ui';
import { formatDateTime, money } from '../format';
import type { AdminBooking, SeatMapResponse } from '../types';

export default function AdminShowDetail() {
  const showId = Number(useParams().id);
  const [map, setMap] = useState<SeatMapResponse | null>(null);
  const [bookings, setBookings] = useState<AdminBooking[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, b] = await Promise.all([api.seatMap(showId), api.adminShowBookings(showId)]);
      setMap(m);
      setBookings(b.bookings);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load this show');
    }
  }, [showId]);

  // The admin's seat map stays live too (same SSE stream customers use).
  useEffect(() => {
    load();
    const events = new EventSource(api.eventsUrl(showId));
    events.addEventListener('seats', () => load());
    return () => events.close();
  }, [showId, load]);

  if (error) return <div className="container"><Notice kind="error">{error}</Notice><Link to="/admin/shows">← All shows</Link></div>;
  if (!map) return <div className="container"><Spinner /></div>;

  const confirmed = bookings.filter((b) => b.status === 'confirmed');
  const bookedSeats = confirmed.reduce((n, b) => n + b.seats.length, 0);
  const revenue = confirmed.reduce((n, b) => n + b.amount, 0);
  const percent = Math.round((bookedSeats / map.totalSeats) * 1000) / 10;

  return (
    <div className="container">
      <Link to="/admin/shows" className="back">← All shows</Link>
      <h1>{map.show.movie.title}</h1>
      <p className="muted">{formatDateTime(map.show.startsAt)} · {money(map.show.price)} per seat</p>

      <div className="stats">
        <div className="card stat"><span className="muted small">Seats booked</span><strong>{bookedSeats} / {map.totalSeats}</strong></div>
        <div className="card stat"><span className="muted small">Full</span><strong>{percent}%</strong></div>
        <div className="card stat"><span className="muted small">Money collected</span><strong>{money(revenue)}</strong></div>
      </div>

      <div className="admin-detail">
        <div className="card seat-card">
          <h2>Seat map</h2>
          <SeatMap seats={map.seats} locked />
        </div>
        <div>
          <h2>Bookings</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Booking ID</th><th>Customer</th><th>Seats</th><th>Booked at</th><th>Status</th></tr></thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className={b.status === 'cancelled' ? 'row-past' : ''}>
                    <td className="mono">{b.id}</td>
                    <td>{b.customerName}<br /><span className="muted small">{b.customerEmail}</span></td>
                    <td>{b.seats.join(', ')}</td>
                    <td>{formatDateTime(b.bookedAt)}</td>
                    <td><StatusBadge status={b.status} /></td>
                  </tr>
                ))}
                {bookings.length === 0 && <tr><td colSpan={5} className="muted">No bookings for this show yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
