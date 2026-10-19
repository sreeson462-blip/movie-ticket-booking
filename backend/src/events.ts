import type { Response } from 'express';

/**
 * Tiny Server-Sent Events hub (flow 10: live seat updates).
 * Clients subscribe per show; whenever seats change we send a "seats" event and the
 * browser re-fetches the seat map. The event carries no seat data itself, so there is
 * nothing to keep in sync and nothing sensitive to leak.
 */
const clients = new Map<number, Set<Response>>();
let heartbeat: NodeJS.Timeout | undefined;

export function subscribe(showId: number, res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // tell nginx not to buffer the stream
  });
  res.write('retry: 3000\n: connected\n\n');

  let set = clients.get(showId);
  if (!set) clients.set(showId, (set = new Set()));
  set.add(res);

  if (!heartbeat) {
    // Comment lines keep proxies from closing idle connections.
    heartbeat = setInterval(() => {
      for (const s of clients.values()) for (const r of s) r.write(': ping\n\n');
    }, 25_000);
    heartbeat.unref();
  }

  res.on('close', () => {
    set!.delete(res);
    if (set!.size === 0) clients.delete(showId);
  });
}

export function broadcastSeats(showId: number): void {
  const set = clients.get(showId);
  if (!set) return;
  for (const res of set) res.write(`event: seats\ndata: ${JSON.stringify({ showId, at: Date.now() })}\n\n`);
}
