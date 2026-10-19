import 'dotenv/config';

const isProd = process.env.NODE_ENV === 'production';

if (isProd && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/movies',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  jwtExpiresIn: '7d',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 10),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  holdMinutes: Number(process.env.HOLD_MINUTES ?? 5),
  cancelCutoffHours: 2,
  maxSeatsPerBooking: 6,
};

// Cinema layout: one screen, 8 rows (A-H) x 10 seats = 80 seats.
export const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export const SEATS_PER_ROW = 10;
export const TOTAL_SEATS = ROWS.length * SEATS_PER_ROW;
