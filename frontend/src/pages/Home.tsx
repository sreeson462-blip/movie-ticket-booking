import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../api';
import Poster from '../components/Poster';
import { Notice, RatingBadge, Spinner } from '../components/ui';
import { duration } from '../format';
import type { MovieListItem } from '../types';

export default function Home() {
  const [movies, setMovies] = useState<MovieListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .movies()
      .then((r) => setMovies(r.movies))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load movies'));
  }, []);

  return (
    <div className="container">
      <h1>Now showing</h1>
      <p className="muted lead">Pick a movie, choose your seats, and your seats are yours: no one else can book them.</p>
      {error && <Notice kind="error">{error}</Notice>}
      {!movies && !error && <Spinner />}
      {movies && movies.length === 0 && <Notice>No movies are playing yet. Check back soon.</Notice>}
      <div className="movie-grid">
        {movies?.map((m) => (
          <Link key={m.id} to={`/movies/${m.id}`} className="movie-card" aria-label={`${m.title}, ${m.upcomingShows} upcoming shows`}>
            <Poster title={m.title} url={m.posterUrl} />
            <div className="movie-card-body">
              <h2>{m.title}</h2>
              <p className="meta">
                <RatingBadge rating={m.rating} />
                <span>{m.language}</span>
                <span>·</span>
                <span>{duration(m.durationMinutes)}</span>
              </p>
              <p className="muted small">
                {m.upcomingShows > 0 ? `${m.upcomingShows} upcoming show${m.upcomingShows > 1 ? 's' : ''}` : 'No upcoming shows'}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
