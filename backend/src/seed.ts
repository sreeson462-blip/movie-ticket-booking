import bcrypt from 'bcryptjs';
import { config } from './config';
import { one, pool } from './db';
import { migrate } from './migrate';

/**
 * Seed script. Idempotent: running it twice does not duplicate anything.
 *  - Creates the ADMIN account (the only way an admin can exist; sign-up never creates one).
 *  - Creates two demo customers (two are handy for the "two windows, same seat" demo).
 *  - Adds sample movies and a week of shows if the catalogue is empty.
 */
const ADMIN = {
  name: 'Cinema Admin',
  email: process.env.ADMIN_EMAIL ?? 'admin@cinema.test',
  password: process.env.ADMIN_PASSWORD ?? 'Admin@12345',
};
const CUSTOMERS = [
  { name: 'Asha Customer', email: 'customer@cinema.test', password: 'Customer@123' },
  { name: 'Ravi Customer', email: 'customer2@cinema.test', password: 'Customer@123' },
];

const MOVIES = [
  { title: 'Midnight Express', language: 'English', duration: 128, rating: 'UA', poster: 'https://picsum.photos/seed/midnight/300/450', description: 'A night train, a missing passenger and a detective with one hour to solve it.' },
  { title: 'Monsoon Melodies', language: 'Hindi', duration: 142, rating: 'U', poster: 'https://picsum.photos/seed/monsoon/300/450', description: 'Two street musicians in Mumbai chase one big break during the rainy season.' },
  { title: 'Orbit Zero', language: 'English', duration: 150, rating: 'UA', poster: 'https://picsum.photos/seed/orbit/300/450', description: 'A crew stranded above Earth must repair their station before the oxygen runs out.' },
  { title: 'The Last Lantern', language: 'Tamil', duration: 135, rating: 'UA', poster: null, description: 'A lighthouse keeper guards a village secret that the sea wants back.' },
  { title: 'Laugh Riot', language: 'English', duration: 105, rating: 'U', poster: 'https://picsum.photos/seed/laugh/300/450', description: 'A wedding planner has 24 hours to save the funniest wedding in town.' },
  { title: 'Shadow Ledger', language: 'Hindi', duration: 118, rating: 'A', poster: null, description: 'An auditor finds a second set of books and a very dangerous client.' },
];

// Start times for each day. The longest movie is 150 minutes, so these never overlap.
const SLOTS: Array<[number, number]> = [[10, 0], [13, 30], [17, 0], [20, 30]];
const PRICES = [150, 200, 250, 300];

async function upsertUser(u: { name: string; email: string; password: string }, role: 'admin' | 'customer') {
  const hash = await bcrypt.hash(u.password, config.bcryptRounds);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)
     ON CONFLICT (lower(email)) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
    [u.name, u.email.toLowerCase(), hash, role],
  );
}

async function main() {
  await migrate();
  await upsertUser(ADMIN, 'admin');
  for (const c of CUSTOMERS) await upsertUser(c, 'customer');

  const existing = await one<{ n: number }>(pool, 'SELECT count(*)::int AS n FROM movies');
  if (existing!.n === 0) {
    const ids: Array<{ id: number; duration: number }> = [];
    for (const m of MOVIES) {
      const row = await one<{ id: number }>(
        pool,
        `INSERT INTO movies (title, description, language, duration_minutes, rating, poster_url)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [m.title, m.description, m.language, m.duration, m.rating, m.poster],
      );
      ids.push({ id: row!.id, duration: m.duration });
    }

    let n = 0;
    const now = Date.now();
    for (let day = 0; day < 7; day++) {
      for (let s = 0; s < SLOTS.length; s++) {
        const start = new Date();
        start.setDate(start.getDate() + day);
        start.setHours(SLOTS[s][0], SLOTS[s][1], 0, 0);
        if (start.getTime() <= now) continue;
        const movie = ids[(day + s * 2) % ids.length];
        await pool.query(
          `INSERT INTO shows (movie_id, starts_at, ends_at, price)
           VALUES ($1, $2, $2::timestamptz + make_interval(mins => $3), $4)`,
          [movie.id, start.toISOString(), movie.duration, PRICES[s]],
        );
        n++;
      }
    }
    console.log(`Seeded ${ids.length} movies and ${n} shows.`);
  } else {
    console.log('Movies already exist: leaving the catalogue untouched.');
  }

  console.log('\nTest logins');
  console.log(`  Admin     ${ADMIN.email} / ${ADMIN.password}`);
  for (const c of CUSTOMERS) console.log(`  Customer  ${c.email} / ${c.password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
