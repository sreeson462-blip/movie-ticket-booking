import { FormEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { Notice } from '../components/ui';

export default function Signup() {
  const { user, signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signup(name, email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create your account');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container narrow">
      <h1>Create your account</h1>
      <form className="card form" onSubmit={submit}>
        {error && <Notice kind="error">{error}</Notice>}
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={100} autoFocus />
        </label>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required minLength={8} />
          <small className="muted">At least 8 characters</small>
        </label>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating account…' : 'Sign up'}</button>
        <p className="muted">
          Already have an account? <Link to="/login" state={{ from }}>Log in</Link>
        </p>
      </form>
    </div>
  );
}
