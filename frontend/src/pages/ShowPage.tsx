import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api';
import SeatMap from '../components/SeatMap';
import { useCountdown } from '../components/hooks';
import { Notice, RatingBadge, Spinner } from '../components/ui';
import { formatDateTime, mmss, money } from '../format';
import type { SeatMapResponse } from '../types';

const MAX_SEATS = 6;

type NoticeState = { kind: 'info' | 'error' | 'success'; text: string } | null;
type PayStep = 'closed' | 'choose' | 'processing' | 'failed';

export default function ShowPage() {
  const { id } = useParams();
  const showId = Number(id);
  const navigate = useNavigate();

  const [data, setData] = useState<SeatMapResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [holding, setHolding] = useState(false);
  const [payStep, setPayStep] = useState<PayStep>('closed');
  const [payMessage, setPayMessage] = useState('');

  const selectedRef = useRef<string[]>([]);
  selectedRef.current = selected;
  const hadHold = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await api.seatMap(showId);
      setClockOffset(new Date(res.serverTime).getTime() - Date.now());
      setData(res);
      setLoadError(null);

      // Seats I picked but that someone else took in the meantime.
      const lost = selectedRef.current.filter((l) => res.seats.find((s) => s.label === l)?.status !== 'available');
      if (lost.length) {
        setSelected((prev) => prev.filter((l) => !lost.includes(l)));
        setNotice({ kind: 'error', text: `Seat${lost.length > 1 ? 's' : ''} ${lost.join(', ')} ${lost.length > 1 ? 'were' : 'was'} taken by someone else.` });
      }

      // My hold disappeared without me paying or releasing it: it ran out.
      if (hadHold.current && !res.myHold) {
        setPayStep('closed');
        setNotice({ kind: 'error', text: 'Your 5-minute hold ran out, so those seats were released. Please select your seats again.' });
      }
      hadHold.current = !!res.myHold;
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load the seat map');
    }
  }, [showId]);

  // First load, then keep the map live (flow 10): SSE pushes "something changed", we re-fetch.
  // A slow poll and a refresh-on-focus are safety nets if the stream drops.
  useEffect(() => {
    refresh();
    const events = new EventSource(api.eventsUrl(showId));
    events.addEventListener('seats', () => refresh());
    const poll = setInterval(refresh, 15_000);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      events.close();
      clearInterval(poll);
      window.removeEventListener('focus', onFocus);
    };
  }, [showId, refresh]);

  const hold = data?.myHold ?? null;
  const remaining = useCountdown(hold?.expiresAt, clockOffset, refresh);

  const price = data?.show.price ?? 0;
  const total = selected.length * price;

  function toggle(label: string) {
    setNotice(null);
    setSelected((prev) => {
      if (prev.includes(label)) return prev.filter((l) => l !== label);
      if (prev.length >= MAX_SEATS) {
        setNotice({ kind: 'error', text: `You can select at most ${MAX_SEATS} seats per booking.` });
        return prev;
      }
      return [...prev, label].sort((a, b) => a[0].localeCompare(b[0]) || Number(a.slice(1)) - Number(b.slice(1)));
    });
  }

  async function continueToHold() {
    setHolding(true);
    setNotice(null);
    try {
      await api.hold(showId, selected);
      setSelected([]);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setNotice({ kind: 'error', text: err.message });
        const taken: string[] = err.data.conflictingSeats ?? [];
        setSelected((prev) => prev.filter((l) => !taken.includes(l)));
      } else {
        setNotice({ kind: 'error', text: 'Could not hold your seats.' });
      }
      await refresh();
    } finally {
      setHolding(false);
    }
  }

  async function changeSeats() {
    if (!hold) return;
    hadHold.current = false; // releasing on purpose is not "expiry"
    setPayStep('closed');
    try {
      await api.release(hold.bookingId);
    } finally {
      await refresh();
    }
  }

  async function pay(outcome: 'success' | 'failure') {
    if (!hold) return;
    setPayStep('processing');
    try {
      const r = await api.pay(hold.bookingId, outcome);
      hadHold.current = false;
      navigate(`/bookings/${r.booking.id}`, { state: { justBooked: true } });
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        setPayMessage(err.message);
        setPayStep('failed');
      } else {
        // Hold expired (410) or anything else unexpected: close the dialog and explain.
        setPayStep('closed');
        setNotice({ kind: 'error', text: err instanceof ApiError ? err.message : 'Payment could not be completed.' });
        await refresh();
      }
    }
  }

  if (loadError && !data) {
    return <div className="container"><Notice kind="error">{loadError}</Notice><Link to="/">← All movies</Link></div>;
  }
  if (!data) return <div className="container"><Spinner label="Loading seat map…" /></div>;

  const { show } = data;
  const started = show.started;

  return (
    <div className="container">
      <Link to={`/movies/${show.movie.id}`} className="back">← {show.movie.title}</Link>
      <header className="show-header">
        <div>
          <h1>{show.movie.title}</h1>
          <p className="meta">
            <RatingBadge rating={show.movie.rating} />
            <span>{show.movie.language}</span>
            <span>·</span>
            <span>{formatDateTime(show.startsAt)}</span>
            <span>·</span>
            <span>{money(show.price)} per seat</span>
          </p>
        </div>
        <p className="muted" aria-live="polite">{show.availableSeats} of {show.totalSeats} seats available</p>
      </header>

      {started && <Notice kind="error">This show has already started, so booking is closed.</Notice>}
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      {loadError && <Notice kind="error">{loadError}</Notice>}

      <div className="booking-layout">
        <div className="card seat-card">
          <SeatMap seats={data.seats} selected={selected} onToggle={toggle} locked={started || !!hold || holding} />
        </div>

        <aside className="card summary" aria-live="polite">
          {hold ? (
            <>
              <h2>Seats held for you</h2>
              <p className="big-seats" data-testid="held-seats">{hold.seats.join(', ')}</p>
              <div className={`timer ${remaining < 60_000 ? 'timer-low' : ''}`} role="timer" aria-label="Time left to pay">
                <span className="muted small">Time left to pay</span>
                <strong data-testid="countdown">{mmss(remaining)}</strong>
              </div>
              <dl className="totals">
                <dt>{hold.seats.length} × {money(price)}</dt>
                <dd>{money(hold.amount)}</dd>
              </dl>
              <button className="btn btn-primary btn-block" onClick={() => { setPayMessage(''); setPayStep('choose'); }} disabled={remaining === 0}>
                Pay {money(hold.amount)}
              </button>
              <button className="btn btn-ghost btn-block" onClick={changeSeats}>Change seats</button>
            </>
          ) : (
            <>
              <h2>Your selection</h2>
              {selected.length === 0 ? (
                <p className="muted">Click up to {MAX_SEATS} available seats on the map.</p>
              ) : (
                <>
                  <p className="big-seats" data-testid="selected-seats">{selected.join(', ')}</p>
                  <dl className="totals">
                    <dt>{selected.length} × {money(price)}</dt>
                    <dd data-testid="total">{money(total)}</dd>
                  </dl>
                </>
              )}
              <button className="btn btn-primary btn-block" disabled={selected.length === 0 || holding || started} onClick={continueToHold}>
                {holding ? 'Holding seats…' : 'Continue'}
              </button>
              <p className="muted small">Continuing holds your seats for 5 minutes while you pay.</p>
            </>
          )}
        </aside>
      </div>

      {payStep !== 'closed' && hold && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="pay-title">
          <div className="modal card">
            <h2 id="pay-title">Test payment</h2>
            <p className="muted small">No real money is charged. Choose what the payment should do.</p>
            <dl className="totals">
              <dt>{hold.seats.join(', ')}</dt>
              <dd>{money(hold.amount)}</dd>
            </dl>
            <p className="muted small">Hold expires in <strong>{mmss(remaining)}</strong></p>

            {payStep === 'failed' && (
              <Notice kind="error">
                <strong>Payment failed.</strong> {payMessage}
              </Notice>
            )}

            {payStep === 'failed' ? (
              <div className="modal-actions">
                <button className="btn btn-primary" onClick={() => setPayStep('choose')}>Try again</button>
                <button className="btn btn-ghost" onClick={() => setPayStep('closed')}>Close</button>
              </div>
            ) : (
              <div className="modal-actions">
                <button className="btn btn-success" disabled={payStep === 'processing'} onClick={() => pay('success')}>Payment success</button>
                <button className="btn btn-danger" disabled={payStep === 'processing'} onClick={() => pay('failure')}>Payment failure</button>
                <button className="btn btn-ghost" disabled={payStep === 'processing'} onClick={() => setPayStep('closed')}>Cancel</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
