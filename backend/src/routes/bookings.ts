import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth';
import { pool } from '../db';
import { cancelBooking, getBookingView, listUserBookings, payForBooking, releaseHold } from '../services/bookings';

export const bookingsRouter = Router();

// Every route below needs a valid login, enforced here on the server (not just in the UI).
bookingsRouter.use(requireAuth);

// Flow 6: only the caller's own bookings, upcoming first, then past.
bookingsRouter.get('/', async (req, res) => {
  res.json({ bookings: await listUserBookings(req.user!.id) });
});

// Another user's booking id returns 404, identical to a booking that does not exist.
bookingsRouter.get('/:id', async (req, res) => {
  res.json({ booking: await getBookingView(pool, req.params.id, req.user!.id) });
});

const paySchema = z.object({ outcome: z.enum(['success', 'failure']) });

// Flow 5: fake payment step ("Payment success" / "Payment failure" buttons).
bookingsRouter.post('/:id/pay', async (req, res) => {
  const { outcome } = paySchema.parse(req.body);
  res.json({ booking: await payForBooking(req.user!.id, req.params.id, outcome) });
});

// Give seats back without waiting for the 5 minutes to run out.
bookingsRouter.post('/:id/release', async (req, res) => {
  await releaseHold(req.user!.id, req.params.id);
  res.status(204).end();
});

// Flow 8 (bonus): cancel up to 2 hours before the show.
bookingsRouter.post('/:id/cancel', async (req, res) => {
  res.json({ booking: await cancelBooking(req.user!.id, req.params.id) });
});
