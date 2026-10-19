import cors from 'cors';
import express from 'express';
import { config } from './config';
import { errorHandler, notFound } from './errors';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { bookingsRouter } from './routes/bookings';
import { publicRouter } from './routes/public';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigin.split(','), credentials: false }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter);
  app.use('/api/bookings', bookingsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', publicRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
