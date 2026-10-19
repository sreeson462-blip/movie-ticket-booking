import type { SeatInfo } from '../types';

interface Props {
  seats: SeatInfo[];
  selected?: string[];
  onToggle?: (label: string) => void;
  /** When true nothing can be clicked (admin view, or while seats are held). */
  locked?: boolean;
}

const AISLE_AFTER = 5;

function seatClass(seat: SeatInfo, isSelected: boolean) {
  if (isSelected) return 'seat seat-selected';
  if (seat.status === 'booked') return 'seat seat-booked';
  if (seat.status === 'held') return seat.mine ? 'seat seat-mine' : 'seat seat-held';
  return 'seat seat-available';
}

function seatTitle(seat: SeatInfo, isSelected: boolean) {
  if (isSelected) return `${seat.label}: selected`;
  if (seat.status === 'booked') return `${seat.label}: booked`;
  if (seat.status === 'held') return seat.mine ? `${seat.label}: held for you` : `${seat.label}: held by someone else`;
  return `${seat.label}: available`;
}

export default function SeatMap({ seats, selected = [], onToggle, locked = false }: Props) {
  const rows = [...new Set(seats.map((s) => s.row))];
  const selectedSet = new Set(selected);

  return (
    <div className="seatmap" role="group" aria-label="Seat map">
      <div className="screen" aria-hidden>
        <div className="screen-bar" />
        <span>Screen this way</span>
      </div>

      <div className="seat-rows">
        {rows.map((row) => (
          <div className="seat-row" key={row}>
            <span className="row-label" aria-hidden>{row}</span>
            {seats
              .filter((s) => s.row === row)
              .map((seat) => {
                const isSelected = selectedSet.has(seat.label);
                const clickable = !locked && (seat.status === 'available' || isSelected);
                return (
                  <span key={seat.label} className="seat-cell" data-aisle={seat.number === AISLE_AFTER ? 'true' : undefined}>
                    <button
                      type="button"
                      className={seatClass(seat, isSelected)}
                      title={seatTitle(seat, isSelected)}
                      aria-label={seatTitle(seat, isSelected)}
                      aria-pressed={isSelected}
                      disabled={!clickable}
                      data-seat={seat.label}
                      data-status={isSelected ? 'selected' : seat.status}
                      onClick={() => onToggle?.(seat.label)}
                    >
                      {seat.number}
                    </button>
                  </span>
                );
              })}
            <span className="row-label" aria-hidden>{row}</span>
          </div>
        ))}
      </div>

      <ul className="legend" aria-label="Legend">
        <li><span className="seat seat-available" /> Available</li>
        <li><span className="seat seat-selected" /> Selected</li>
        <li><span className="seat seat-mine" /> Held for you</li>
        <li><span className="seat seat-held" /> Held by someone else</li>
        <li><span className="seat seat-booked" /> Booked</li>
      </ul>
    </div>
  );
}
