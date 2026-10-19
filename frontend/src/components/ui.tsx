import type { ReactNode } from 'react';
import type { BookingStatus, Rating } from '../types';

export function RatingBadge({ rating }: { rating: Rating }) {
  return <span className={`badge badge-rating badge-${rating}`} title={`Rated ${rating}`}>{rating}</span>;
}

export function StatusBadge({ status }: { status: BookingStatus }) {
  const label = status === 'confirmed' ? 'Confirmed' : status === 'cancelled' ? 'Cancelled' : status[0].toUpperCase() + status.slice(1);
  return <span className={`badge badge-status badge-${status}`}>{label}</span>;
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'error' | 'success'; children: ReactNode }) {
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <p className="muted" role="status">{label}</p>;
}
