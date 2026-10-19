import { FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import AdminNav from '../components/AdminNav';
import Poster from '../components/Poster';
import { Notice, RatingBadge, Spinner } from '../components/ui';
import { duration } from '../format';
import type { MovieInput, MovieListItem, Rating } from '../types';

const EMPTY: MovieInput = { title: '', description: '', language: 'English', durationMinutes: 120, rating: 'UA', posterUrl: '' };

export default function AdminMovies() {
  const [movies, setMovies] = useState<MovieListItem[] | null>(null);
  const [form, setForm] = useState<MovieInput>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.movies().then((r) => setMovies(r.movies));
  useEffect(() => {
    load().catch((e) => setNotice({ kind: 'error', text: e.message }));
  }, []);

  const set = <K extends keyof MovieInput>(key: K, value: MovieInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  function edit(m: MovieListItem) {
    setEditingId(m.id);
    setForm({ title: m.title, description: m.description, language: m.language, durationMinutes: m.durationMinutes, rating: m.rating, posterUrl: m.posterUrl ?? '' });
    setNotice(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function reset() {
    setEditingId(null);
    setForm(EMPTY);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      if (editingId) await api.updateMovie(editingId, form);
      else await api.createMovie(form);
      setNotice({ kind: 'success', text: editingId ? 'Movie updated.' : 'Movie added.' });
      reset();
      await load();
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not save the movie' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: MovieListItem) {
    if (!window.confirm(`Delete "${m.title}" and all of its shows? This cannot be undone.`)) return;
    setNotice(null);
    try {
      await api.deleteMovie(m.id);
      setNotice({ kind: 'success', text: `"${m.title}" was deleted.` });
      if (editingId === m.id) reset();
      await load();
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not delete the movie' });
    }
  }

  return (
    <div className="container">
      <AdminNav />
      <h1>Movies</h1>
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

      <form className="card form form-grid" onSubmit={submit}>
        <h2 className="span-2">{editingId ? 'Edit movie' : 'Add a movie'}</h2>
        <label className="field span-2">
          <span>Title</span>
          <input value={form.title} onChange={(e) => set('title', e.target.value)} required maxLength={200} />
        </label>
        <label className="field">
          <span>Language</span>
          <input value={form.language} onChange={(e) => set('language', e.target.value)} required maxLength={50} />
        </label>
        <label className="field">
          <span>Duration (minutes)</span>
          <input type="number" min={1} max={600} value={form.durationMinutes} onChange={(e) => set('durationMinutes', Number(e.target.value))} required />
        </label>
        <label className="field">
          <span>Rating</span>
          <select value={form.rating} onChange={(e) => set('rating', e.target.value as Rating)}>
            <option value="U">U (everyone)</option>
            <option value="UA">UA (parental guidance)</option>
            <option value="A">A (adults only)</option>
          </select>
        </label>
        <label className="field">
          <span>Poster image URL (optional)</span>
          <input type="url" value={form.posterUrl} onChange={(e) => set('posterUrl', e.target.value)} placeholder="https://…" />
        </label>
        <label className="field span-2">
          <span>Description</span>
          <textarea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={2000} />
        </label>
        <div className="span-2 row-actions">
          <button className="btn btn-primary" disabled={busy}>{editingId ? 'Save changes' : 'Add movie'}</button>
          {editingId && <button type="button" className="btn btn-ghost" onClick={reset}>Cancel editing</button>}
        </div>
      </form>

      <h2>All movies</h2>
      {!movies ? <Spinner /> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th></th><th>Title</th><th>Language</th><th>Duration</th><th>Rating</th><th>Upcoming shows</th><th></th></tr>
            </thead>
            <tbody>
              {movies.map((m) => (
                <tr key={m.id}>
                  <td><Poster title={m.title} url={m.posterUrl} size="xs" /></td>
                  <td><strong>{m.title}</strong></td>
                  <td>{m.language}</td>
                  <td>{duration(m.durationMinutes)}</td>
                  <td><RatingBadge rating={m.rating} /></td>
                  <td>{m.upcomingShows}</td>
                  <td className="actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => edit(m)}>Edit</button>
                    <button className="btn btn-danger btn-sm" onClick={() => remove(m)}>Delete</button>
                  </td>
                </tr>
              ))}
              {movies.length === 0 && <tr><td colSpan={7} className="muted">No movies yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
