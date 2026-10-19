import { createApp } from './app';
import { config } from './config';
import { migrate } from './migrate';
import { pool } from './db';
import { sweepExpiredHolds } from './services/bookings';

async function main() {
  await migrate(); // idempotent, so `docker compose up` works on an empty database
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port}`);
  });

  // Free expired holds every 5 seconds and tell open seat maps (SSE) about it.
  const sweeper = setInterval(sweepExpiredHolds, 5_000);

  const shutdown = () => {
    clearInterval(sweeper);
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 3000).unref(); // SSE connections can keep the server open
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
