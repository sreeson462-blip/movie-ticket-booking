export type Role = 'customer' | 'admin';
export type Rating = 'U' | 'UA' | 'A';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
}

export interface Movie {
  id: number;
  title: string;
  description: string;
  language: string;
  durationMinutes: number;
  rating: Rating;
  posterUrl: string | null;
}

export interface MovieListItem extends Movie {
  upcomingShows: number;
  nextShowAt: string | null;
}

export interface Show {
  id: number;
  movieId: number;
  startsAt: string;
  endsAt: string;
  price: number;
  availableSeats: number;
  totalSeats: number;
}

export interface ShowWithMovie extends Show {
  movie: Pick<Movie, 'id' | 'title' | 'posterUrl' | 'language' | 'rating' | 'durationMinutes'>;
}

export type SeatStatus = 'available' | 'held' | 'booked';

export interface SeatInfo {
  row: string;
  number: number;
  label: string;
  status: SeatStatus;
  mine: boolean;
}

export interface MyHold {
  bookingId: string;
  expiresAt: string;
  amount: number;
  seats: string[];
}

export interface SeatMapResponse {
  show: ShowWithMovie & { started: boolean };
  seats: SeatInfo[];
  totalSeats: number;
  myHold: MyHold | null;
  serverTime: string;
}

export type BookingStatus = 'held' | 'confirmed' | 'cancelled' | 'expired' | 'released';

export interface Booking {
  id: string;
  status: BookingStatus;
  amount: number;
  seats: string[];
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  holdExpiresAt: string | null;
  canCancel: boolean;
  show: { id: number; startsAt: string; endsAt: string; price: number };
  movie: { id: number; title: string; posterUrl: string | null; language: string; rating: Rating };
}

export interface AdminShow {
  id: number;
  startsAt: string;
  endsAt: string;
  price: number;
  past: boolean;
  movie: { id: number; title: string; language: string; rating: Rating };
  bookedSeats: number;
  heldSeats: number;
  totalSeats: number;
  percentFull: number;
  revenue: number;
  hasBookings: boolean;
}

export interface AdminBooking {
  id: string;
  status: BookingStatus;
  amount: number;
  seats: string[];
  bookedAt: string;
  cancelledAt: string | null;
  customerName: string;
  customerEmail: string;
}

export interface MovieInput {
  title: string;
  description: string;
  language: string;
  durationMinutes: number;
  rating: Rating;
  posterUrl: string;
}
