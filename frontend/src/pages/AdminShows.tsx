import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../api';
import AdminNav from '../components/AdminNav';
import { Notice, Spinner } from '../components/ui';
import { formatDate, formatTime, money, toLocalInput } from '../format';
import type { AdminShow, MovieListItem } from '../types';

export default function AdminShows() {
  const [shows, setShows] = useState<AdminShow[] | null>(null);
  const [movies, setMovies] = useState<MovieListItem[]>([]);
  const [movieId, setMovieId] = useState('');
  const [startsAt, setStartsAt] = useState(() => {
    const d = new Date(Date.now() + 24 * 3_600_000);
    d.setMinutes(0, 0, 0);
    return toLocalInput(d);
  });
  const [price, setPrice] = useState(200);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.adminShows().then((r) => setShows(r.shows));

  useEffect(() => {
    load().catch((e) => setNotice({ kind: 'error', text: e.message }));
    api.movies().then((r) => {
      setMovies(r.movies);
      if (r.movies[0]) setMovieId(String(r.movies[0].id));
    });
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await api.createShow({ movieId: Number(movieId), startsAt: new Date(startsAt).toISOString(), price });
      setNotice({ kind: 'success', text: 'Show added.' });
      await load();
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not add the show' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: AdminShow) {
    if (!window.confirm(`Delete the ${formatTime(s.startsAt)} show of "${s.movie.title}" on ${formatDate(s.startsAt)}?`)) return;
    setNotice(null);
    try {
      await api.deleteShow(s.id);
      setNotice({ kind: 'success', text: 'Show deleted.' });
      await load();
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not delete the show' });
    }
  }

  return (
    <div className="container">
      <AdminNav />
      <h1>Shows &amp; bookings</h1>
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

      <form className="card form form-inline" onSubmit={add}>
        <h2>Add a show</h2>
        <label className="field">
          <span>Movie</span>
          <select value={movieId} onChange={(e) => setMovieId(e.target.value)} required>
            {movies.map((m) => <option key={m.id} value={m.id}>{m.title} ({m.durationMinutes} min)</option>)}
          </select>
        </label>
        <label className="field">
          <span>Date &amp; start time</span>
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
        </label>
        <label className="field">
          <span>Ticket price (₹)</span>
          <input type="number" min={0} max={100000} value={price} onChange={(e) => setPrice(Number(e.target.value))} required />
        </label>
        <button className="btn btn-primary" disabled={busy || !movieId}>Add show</button>
        <p className="muted small span-all">The single screen is busy from the start time until start + movie duration; overlapping shows are rejected.</p>
      </form>

      <h2>All shows</h2>
      {!shows ? <Spinner /> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Movie</th><th>When</th><th>Price</th><th>Booked</th><th>Full</th><th>Collected</th><th></th></tr>
            </thead>
            <tbody>
              {shows.map((s) => (
                <tr key={s.id} className={s.past ? 'row-past' : ''}>
                  <td><strong>{s.movie.title}</strong></td>
                  <td>{formatDate(s.startsAt)}<br /><span className="muted">{formatTime(s.startsAt)} – {formatTime(s.endsAt)}{s.past ? ' · past' : ''}</span></td>
                  <td>{money(s.price)}</td>
                  <td>{s.bookedSeats} / {s.totalSeats}{s.heldSeats > 0 && <span className="muted small"> (+{s.heldSeats} held)</span>}</td>
                  <td>
                    <div className="bar" role="img" aria-label={`${s.percentFull}% full`}><div style={{ width: `${s.percentFull}%` }} /></div>
                    <span className="small">{s.percentFull}%</span>
                  </td>
                  <td>{money(s.revenue)}</td>
                  <td className="actions">
                    <Link className="btn btn-ghost btn-sm" to={`/admin/shows/${s.id}`}>Open</Link>
                    <button className="btn btn-danger btn-sm" disabled={s.hasBookings} title={s.hasBookings ? 'Shows with bookings cannot be deleted' : 'Delete show'} onClick={() => remove(s)}>Delete</button>
                  </td>
                </tr>
              ))}
              {shows.length === 0 && <tr><td colSpan={7} className="muted">No shows yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
