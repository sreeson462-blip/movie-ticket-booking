import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../api';
import Poster from '../components/Poster';
import { Notice, RatingBadge, Spinner } from '../components/ui';
import { dayKey, duration, formatDate, formatTime, money } from '../format';
import type { Movie, Show } from '../types';

export default function MovieDetail() {
  const { id } = useParams();
  const [movie, setMovie] = useState<Movie | null>(null);
  const [shows, setShows] = useState<Show[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMovie(null);
    setError(null);
    api
      .movie(Number(id))
      .then((r) => {
        setMovie(r.movie);
        setShows(r.shows);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load this movie'));
  }, [id]);

  // Group upcoming shows by (local) date.
  const days = useMemo(() => {
    const groups = new Map<string, Show[]>();
    for (const s of shows) {
      const k = dayKey(s.startsAt);
      groups.set(k, [...(groups.get(k) ?? []), s]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [shows]);

  if (error) return <div className="container"><Notice kind="error">{error}</Notice><Link to="/">← All movies</Link></div>;
  if (!movie) return <div className="container"><Spinner /></div>;

  return (
    <div className="container">
      <Link to="/" className="back">← All movies</Link>
      <section className="movie-hero">
        <Poster title={movie.title} url={movie.posterUrl} size="lg" />
        <div>
          <h1>{movie.title}</h1>
          <p className="meta">
            <RatingBadge rating={movie.rating} />
            <span>{movie.language}</span>
            <span>·</span>
            <span>{duration(movie.durationMinutes)}</span>
          </p>
          <p>{movie.description || 'No description yet.'}</p>
        </div>
      </section>

      <h2>Upcoming shows</h2>
      {days.length === 0 && <Notice>There are no upcoming shows for this movie.</Notice>}
      {days.map(([key, list]) => (
        <section key={key} className="show-day">
          <h3>{formatDate(list[0].startsAt)}</h3>
          <div className="show-list">
            {list.map((s) => {
              const soldOut = s.availableSeats === 0;
              const body = (
                <>
                  <strong>{formatTime(s.startsAt)}</strong>
                  <span>{money(s.price)} / seat</span>
                  <span className={soldOut ? 'avail avail-none' : s.availableSeats <= 10 ? 'avail avail-low' : 'avail'}>
                    {soldOut ? 'Sold out' : `${s.availableSeats} of ${s.totalSeats} seats left`}
                  </span>
                </>
              );
              return soldOut ? (
                <div key={s.id} className="show-card show-card-disabled" aria-disabled="true">{body}</div>
              ) : (
                <Link key={s.id} to={`/shows/${s.id}`} className="show-card">{body}</Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
