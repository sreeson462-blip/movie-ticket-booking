import { useEffect, useRef, useState } from 'react';

/**
 * Milliseconds left until `expiresAt`, updated 4x per second. `clockOffsetMs` is
 * (server time - browser time), so a wrong laptop clock cannot make the timer lie.
 * `onExpire` fires once when the countdown reaches zero.
 */
export function useCountdown(expiresAt: string | null | undefined, clockOffsetMs: number, onExpire?: () => void) {
  const [remaining, setRemaining] = useState(0);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (!expiresAt) {
      setRemaining(0);
      return;
    }
    const target = new Date(expiresAt).getTime();
    let fired = false;
    const tick = () => {
      const left = Math.max(0, target - (Date.now() + clockOffsetMs));
      setRemaining(left);
      if (left === 0 && !fired) {
        fired = true;
        onExpireRef.current?.();
      }
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [expiresAt, clockOffsetMs]);

  return remaining;
}
