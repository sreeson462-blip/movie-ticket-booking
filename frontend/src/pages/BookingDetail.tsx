import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ApiError, api } from '../api';
import Poster from '../components/Poster';
import { Notice, Spinner, StatusBadge } from '../components/ui';
import { formatDate, formatDateTime, formatTime, money } from '../format';
import type { Booking } from '../types';

export default function BookingDetail() {
  const { id } = useParams();
  const justBooked = (useLocation().state as { justBooked?: boolean } | null)?.justBooked;
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .booking(id!)
      .then((r) => setBooking(r.booking))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load this booking'));
  }, [id]);

  if (error) return <div className="container narrow"><Notice kind="error">{error}</Notice><Link to="/bookings">← My bookings</Link></div>;
  if (!booking) return <div className="container narrow"><Spinner /></div>;

  return (
    <div className="container narrow">
      {justBooked && booking.status === 'confirmed' && (
        <Notice kind="success">
          <strong>Booking confirmed!</strong> Your seats are booked. Show this booking ID at the door.
        </Notice>
      )}
      <article className="card ticket" data-testid="booking-confirmation">
        <Poster title={booking.movie.title} url={booking.movie.posterUrl} size="sm" />
        <div>
          <p className="muted small">Booking ID</p>
          <p className="booking-id" data-testid="booking-id">{booking.id}</p>
          <h1>{booking.movie.title}</h1>
          <dl className="details">
            <dt>Date</dt><dd>{formatDate(booking.show.startsAt)}</dd>
            <dt>Time</dt><dd>{formatTime(booking.show.startsAt)}</dd>
            <dt>Seats</dt><dd>{booking.seats.join(', ')}</dd>
            <dt>Amount</dt><dd>{money(booking.amount)}</dd>
            <dt>Status</dt><dd><StatusBadge status={booking.status} /></dd>
            {booking.cancelledAt && (<><dt>Cancelled</dt><dd>{formatDateTime(booking.cancelledAt)}</dd></>)}
          </dl>
        </div>
      </article>
      <p><Link to="/bookings">View all my bookings</Link> · <Link to="/">Book another movie</Link></p>
    </div>
  );
}
