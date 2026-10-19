import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../api';
import Poster from '../components/Poster';
import { Notice, Spinner, StatusBadge } from '../components/ui';
import { formatDate, formatTime, money } from '../format';
import type { Booking } from '../types';

export default function MyBookings() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () =>
    api
      .myBookings()
      .then((r) => setBookings(r.bookings))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load your bookings'));

  useEffect(() => {
    load();
  }, []);

  async function cancel(b: Booking) {
    if (!window.confirm(`Cancel booking ${b.id} for ${b.movie.title} (${b.seats.join(', ')})?`)) return;
    setBusyId(b.id);
    setNotice(null);
    try {
      await api.cancel(b.id);
      setNotice({ kind: 'success', text: `Booking ${b.id} was cancelled and the seats were released.` });
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not cancel this booking' });
    } finally {
      setBusyId(null);
      load();
    }
  }

  if (error) return <div className="container"><Notice kind="error">{error}</Notice></div>;
  if (!bookings) return <div className="container"><Spinner /></div>;

  const now = Date.now();
  const upcoming = bookings.filter((b) => new Date(b.show.startsAt).getTime() >= now);
  const past = bookings.filter((b) => new Date(b.show.startsAt).getTime() < now);

  const renderList = (list: Booking[], isUpcoming: boolean) => (
    <div className="booking-list">
      {list.map((b) => (
        <article key={b.id} className={`card booking-row ${b.status === 'cancelled' ? 'is-cancelled' : ''}`} data-testid="booking-row">
          <Poster title={b.movie.title} url={b.movie.posterUrl} size="sm" />
          <div className="booking-main">
            <p className="booking-id small">{b.id}</p>
            <h3><Link to={`/bookings/${b.id}`}>{b.movie.title}</Link></h3>
            <p className="muted">{formatDate(b.show.startsAt)} · {formatTime(b.show.startsAt)}</p>
            <p>Seats <strong>{b.seats.join(', ')}</strong> · {money(b.amount)}</p>
          </div>
          <div className="booking-side">
            <StatusBadge status={b.status} />
            {isUpcoming && b.status === 'confirmed' && (
              b.canCancel ? (
                <button className="btn btn-danger btn-sm" disabled={busyId === b.id} onClick={() => cancel(b)}>
                  {busyId === b.id ? 'Cancelling…' : 'Cancel booking'}
                </button>
              ) : (
                <span className="muted small">Cancellation closed (under 2 hours to go)</span>
              )
            )}
          </div>
        </article>
      ))}
    </div>
  );

  return (
    <div className="container">
      <h1>My bookings</h1>
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      {bookings.length === 0 && (
        <Notice>You have no bookings yet. <Link to="/">Browse movies</Link></Notice>
      )}
      {upcoming.length > 0 && (<><h2>Upcoming</h2>{renderList(upcoming, true)}</>)}
      {past.length > 0 && (<><h2>Past</h2>{renderList(past, false)}</>)}
    </div>
  );
}
