import { NavLink } from 'react-router-dom';

export default function AdminNav() {
  return (
    <nav className="subnav" aria-label="Admin">
      <NavLink to="/admin/shows">Shows &amp; bookings</NavLink>
      <NavLink to="/admin/movies">Movies</NavLink>
    </nav>
  );
}
