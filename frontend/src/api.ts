import type {
  AdminBooking,
  AdminShow,
  Booking,
  Movie,
  MovieInput,
  MovieListItem,
  SeatMapResponse,
  Show,
  ShowWithMovie,
  User,
} from './types';

const BASE: string = import.meta.env.VITE_API_URL ?? '/api';
const TOKEN_KEY = 'cinema.token';

export const tokenStore = {
  get: (): string | null => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t: string) => {
    try {
      localStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* storage blocked: the session just won't survive a reload */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data: Record<string, any> = {},
  ) {
    super(message);
  }
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = tokenStore.get();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // An invalid/expired token on a protected call: tell the app to log the user out.
    if (res.status === 401 && token && !path.startsWith('/auth/login')) window.dispatchEvent(new Event('auth:expired'));
    throw new ApiError(res.status, data.error ?? 'Something went wrong', data);
  }
  return data as T;
}

export const api = {
  // auth
  signup: (b: { name: string; email: string; password: string }) => request<{ token: string; user: User }>('/auth/signup', 'POST', b),
  login: (b: { email: string; password: string }) => request<{ token: string; user: User }>('/auth/login', 'POST', b),
  me: () => request<{ user: User }>('/auth/me'),

  // browsing
  movies: () => request<{ movies: MovieListItem[] }>('/movies'),
  movie: (id: number) => request<{ movie: Movie; shows: Show[] }>(`/movies/${id}`),
  show: (id: number) => request<{ show: ShowWithMovie }>(`/shows/${id}`),
  seatMap: (id: number) => request<SeatMapResponse>(`/shows/${id}/seats`),
  eventsUrl: (id: number) => `${BASE}/shows/${id}/events`,

  // booking
  hold: (showId: number, seats: string[]) => request<{ booking: Booking }>(`/shows/${showId}/hold`, 'POST', { seats }),
  pay: (bookingId: string, outcome: 'success' | 'failure') => request<{ booking: Booking }>(`/bookings/${bookingId}/pay`, 'POST', { outcome }),
  release: (bookingId: string) => request<void>(`/bookings/${bookingId}/release`, 'POST'),
  myBookings: () => request<{ bookings: Booking[] }>('/bookings'),
  booking: (id: string) => request<{ booking: Booking }>(`/bookings/${encodeURIComponent(id)}`),
  cancel: (id: string) => request<{ booking: Booking }>(`/bookings/${id}/cancel`, 'POST'),

  // admin
  adminShows: () => request<{ shows: AdminShow[] }>('/admin/shows'),
  adminShowBookings: (id: number) =>
    request<{ show: { id: number; startsAt: string; price: number; movieTitle: string }; bookings: AdminBooking[] }>(`/admin/shows/${id}/bookings`),
  createMovie: (m: MovieInput) => request<{ movie: Movie }>('/admin/movies', 'POST', m),
  updateMovie: (id: number, m: MovieInput) => request<{ movie: Movie }>(`/admin/movies/${id}`, 'PUT', m),
  deleteMovie: (id: number) => request<void>(`/admin/movies/${id}`, 'DELETE'),
  createShow: (s: { movieId: number; startsAt: string; price: number }) => request<unknown>('/admin/shows', 'POST', s),
  deleteShow: (id: number) => request<void>(`/admin/shows/${id}`, 'DELETE'),
};
