import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { AdminRoute, ProtectedRoute } from './components/guards';
import AdminMovies from './pages/AdminMovies';
import AdminShowDetail from './pages/AdminShowDetail';
import AdminShows from './pages/AdminShows';
import BookingDetail from './pages/BookingDetail';
import Home from './pages/Home';
import Login from './pages/Login';
import MovieDetail from './pages/MovieDetail';
import MyBookings from './pages/MyBookings';
import ShowPage from './pages/ShowPage';
import Signup from './pages/Signup';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="movies/:id" element={<MovieDetail />} />
        <Route path="login" element={<Login />} />
        <Route path="signup" element={<Signup />} />

        {/* Customer pages: login required */}
        <Route element={<ProtectedRoute />}>
          <Route path="shows/:id" element={<ShowPage />} />
          <Route path="bookings" element={<MyBookings />} />
          <Route path="bookings/:id" element={<BookingDetail />} />
        </Route>

        {/* Admin pages: admin role required */}
        <Route path="admin" element={<AdminRoute />}>
          <Route index element={<Navigate to="shows" replace />} />
          <Route path="movies" element={<AdminMovies />} />
          <Route path="shows" element={<AdminShows />} />
          <Route path="shows/:id" element={<AdminShowDetail />} />
        </Route>

        <Route path="*" element={<div className="container"><h1>Page not found</h1></div>} />
      </Route>
    </Routes>
  );
}
