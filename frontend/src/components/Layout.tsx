import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      <header className="topbar">
        <div className="container topbar-inner">
          <Link to="/" className="brand">
            <span aria-hidden>🎬</span> Cinema<span className="brand-accent">Booking</span>
          </Link>
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end>Movies</NavLink>
            {user && <NavLink to="/bookings">My bookings</NavLink>}
            {user?.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
          </nav>
          <div className="nav-user">
            {user ? (
              <>
                <span className="muted" title={user.email}>
                  {user.name}
                  {user.role === 'admin' && <span className="badge badge-admin">admin</span>}
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    logout();
                    navigate('/');
                  }}
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link className="btn btn-ghost btn-sm" to="/login">Log in</Link>
                <Link className="btn btn-primary btn-sm" to="/signup">Sign up</Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="footer">
        <div className="container muted">One cinema · one screen · 80 seats per show · payments are simulated</div>
      </footer>
    </>
  );
}
