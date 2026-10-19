import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';

/** Customer pages. The API enforces the same rule: this only decides what the UI shows. */
export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="container"><p className="muted">Loading…</p></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

export function AdminRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="container"><p className="muted">Loading…</p></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role !== 'admin') {
    return (
      <div className="container narrow">
        <h1>Admins only</h1>
        <p className="muted">Your account does not have access to the admin area.</p>
      </div>
    );
  }
  return <Outlet />;
}
