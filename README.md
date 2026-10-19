# Movie Ticket Booking

A small-cinema booking site: customers pick a show, choose seats on an 8×10 seat map, hold them for 5 minutes, pay (simulated) and get a booking. **A seat can never be booked twice**, even when two people click at the same instant. The guarantee lives in PostgreSQL, not in the UI.

**Stack:** React 18 + TypeScript (Vite) · Node.js 22 + Express 5 + TypeScript · PostgreSQL 16 (raw SQL via `pg`) · JWT auth · Vitest + Supertest.

## Flows completed

| # | Flow | Status |
|---|------|--------|
| 1 | Sign up / log in / log out | Done |
| 2 | Browse movies and shows | Done |
| 3 | Seat map | Done |
| 4 | Select and hold seats (5 min) | Done |
| 5 | Pay and confirm (fake payment) | Done |
| 6 | My bookings | Done |
| 7 | Admin: movies and shows | Done |
| 8 | Cancel a booking (bonus) | Done |
| 9 | Admin: bookings per show (bonus) | Done |
| 10 | Live seat updates (bonus) | Done (Server-Sent Events) |

Nothing known to be broken. See [Limitations](#limitations-and-what-id-do-next) for honest trade-offs.

## Test logins (created by the seed script)

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@cinema.test` | `Admin@12345` |
| Customer | `customer@cinema.test` | `Customer@123` |
| Customer 2 (for the "two windows" demo) | `customer2@cinema.test` | `Customer@123` |

Normal sign-up can only create customers. An admin exists only through the seed script (`npm run seed`, override with `ADMIN_EMAIL` / `ADMIN_PASSWORD`).

## Run it

### Option A: Docker Compose (one command)

```bash
docker compose up --build
# open http://localhost:8080
```
This starts PostgreSQL, the API (which creates the tables and seeds demo data on start) and the frontend behind nginx.

### Option B: locally (needs Node 20+ and PostgreSQL 14+)

```bash
# 1. Database
createdb movies && createdb movies_test          # or: psql -c "create database movies"

# 2. Backend  (http://localhost:4000)
cd backend
npm install
cp ../.env.example .env                          # edit DATABASE_URL if your Postgres login differs
npm run seed                                     # creates tables, admin + demo customers, 6 movies, a week of shows
npm run dev

# 3. Frontend (http://localhost:5173), in a second terminal
cd frontend
npm install
npm run dev
```
The Vite dev server proxies `/api` to the backend, so there is no CORS setup to do.

### Tests

```bash
cd backend
# uses TEST_DATABASE_URL, default postgres://postgres:postgres@localhost:5432/movies_test (it is wiped on every run)
npm test
```
34 tests cover auth, role separation, hold/pay/expiry, privacy of bookings, cancel rules, overlap rules, admin stats and, most importantly, double booking:

* two users hold the same seat at the same moment: exactly one `201`, one `409`
* 25 users race for one seat: exactly one wins
* 12 users with overlapping multi-seat requests: no seat appears in two successful holds, no deadlock `500`s
* a user's hold expires, someone else takes the seat, the first user tries to pay: `410`, and only one booking exists
* two simultaneous "Pay" requests for the same booking: confirmed once
* the database rejects a second active claim on a seat even for raw SQL

## Database design

```mermaid
erDiagram
  users ||--o{ bookings : makes
  movies ||--o{ shows : "is screened as"
  shows ||--o{ bookings : "is booked in"
  bookings ||--|{ booking_seats : reserves
  bookings ||--o{ payments : "is paid by"
```

| Table | Columns (key points) |
|-------|----------------------|
| **users** | `id` PK, `name`, `email` (unique, case-insensitive index on `lower(email)`), `password_hash` (bcrypt), `role` (`customer`/`admin`), `created_at` |
| **movies** | `id` PK, `title`, `description`, `language`, `duration_minutes` (1–600), `rating` (`U`/`UA`/`A`), `poster_url` (nullable) |
| **shows** | `id` PK, `movie_id` FK→movies (RESTRICT), `starts_at`, `ends_at` (= start + duration), `price` (whole ₹, integer), **EXCLUDE constraint: no two shows' `[starts_at, ends_at)` ranges may overlap** |
| **bookings** | `id` PK (`BK-XXXXXXXXXX`), `user_id` FK, `show_id` FK (RESTRICT), `status` (`held`/`confirmed`/`cancelled`/`expired`/`released`), `amount`, `hold_expires_at`, `created_at`, `confirmed_at`, `cancelled_at` |
| **booking_seats** | `booking_id`, `show_id`, `row_label` (A–H), `seat_number` (1–10), `active` boolean. PK `(booking_id,row_label,seat_number)`, composite FK `(booking_id, show_id)`→bookings, and **partial UNIQUE index on `(show_id,row_label,seat_number) WHERE active`** |
| **payments** | `id` PK, `booking_id` FK, `status` (`success`/`failed`), `amount`, `created_at` (one row per attempt) |

The full DDL is in [`backend/db/schema.sql`](backend/db/schema.sql).

## Key decisions

1. **Node + Express + TypeScript, raw SQL with `pg`.** One language across the stack. I chose raw SQL over an ORM because the interesting logic (the partial unique index, `FOR UPDATE`, the exclusion constraint) is SQL, and I want to see exactly what runs.
2. **PostgreSQL**, because it can enforce the two hard rules by itself: a partial unique index (one active claim per seat) and an exclusion constraint (no overlapping shows).
3. **How double booking is prevented.** Holding seats inserts rows into `booking_seats`. The partial unique index `WHERE active` allows only one active row per `(show, seat)`. If two transactions insert the same seat, PostgreSQL makes the second one wait for the first, then fail with a unique violation; the API turns that into a `409` naming the seat. No "check then insert" gap, no reliance on the frontend. Seats are always inserted in sorted order so overlapping requests cannot deadlock (a deadlock is also caught and reported as a normal conflict).
4. **Holds are rows, and expiry works two ways.** Every read treats a hold as live only while `hold_expires_at > now()` (database clock), so a seat is free to everyone exactly when the 5 minutes end. A background sweep every 5 seconds also flips overdue holds to `expired` and sets `active=false` so the unique-index slot is freed. `holdSeats` does the same cleanup for its show inside its own transaction, so it never depends on the sweeper having run.
5. **Payment is checked server-side under a row lock** (`SELECT … FOR UPDATE`). Paying after expiry returns `410`; double-clicking Pay confirms once. A failed payment keeps the hold until its original expiry, as required.
6. **Overlapping shows are rejected by the database** (`EXCLUDE USING gist (tstzrange(starts_at, ends_at) WITH &&)`), so even two admins adding shows at once cannot create an overlap. Back-to-back shows (one ends exactly when the next starts) are allowed.
7. **Auth:** bcrypt (cost 10) hashes; JWT in the `Authorization` header (7 days). The user and role are re-read from the database on every request, so a token cannot outlive a deleted user or grant a role the user no longer has. Login returns the same message for a wrong email or password and compares against a dummy hash for unknown emails so response time does not reveal which emails exist. Booking and admin routes are guarded on the server (`401` logged out, `403` customer on admin routes); the React route guards only improve the UX.
8. **Privacy of bookings:** every booking query filters by `user_id`, so another user's booking id looks exactly like a missing one (`404`).
9. **Live updates (flow 10) use Server-Sent Events.** The server only pushes a tiny "seats changed" event; the browser then re-fetches the seat map, so there is one source of truth and nothing to keep in sync. I picked SSE over WebSockets because traffic is one-way, it reconnects automatically, and it needs no extra library. A 15-second poll and a refresh-on-focus remain as safety nets. Limitation: the event hub is in memory, so it works for one API process; with several instances I would use PostgreSQL `LISTEN/NOTIFY` or Redis pub/sub.
10. **Prices are integer rupees** (no floating-point money). All times are stored as UTC `timestamptz` and shown in the browser's local time. The hold countdown uses the server's clock (the seat-map response includes `serverTime`), so a wrong laptop clock cannot show a wrong timer.

## Assumptions

* One user can hold seats in several shows at once, but only one active hold per show: choosing new seats replaces the old selection.
* "My bookings" lists confirmed and cancelled bookings; unpaid holds are not bookings.
* A booking can be cancelled while the show is at least 2 hours away. There is no refund logic because payments are simulated.
* A new show must start in the future. Editing the movie or time of a show that has bookings is blocked (price can still change); deleting a movie is blocked if any of its shows has bookings.
* Admin "show has bookings" means confirmed or cancelled bookings. Abandoned holds do not block deletion.
* Rating is one of `U`, `UA`, `A`. Poster is an optional URL with a generated placeholder.

## API summary

| Method & path | Who | Purpose |
|---|---|---|
| `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me` | public / user | Accounts |
| `GET /api/movies`, `GET /api/movies/:id` | public | Movies; upcoming shows with seats left |
| `GET /api/shows/:id`, `GET /api/shows/:id/seats` | public | Show and 80-seat map (`available`/`held`/`booked`, plus `mine` and `myHold` when logged in) |
| `GET /api/shows/:id/events` | public | SSE stream of "seats changed" |
| `POST /api/shows/:id/hold` | customer | Hold 1–6 seats for 5 minutes |
| `POST /api/bookings/:id/pay` `{outcome}` | owner | Fake payment: `success` or `failure` |
| `POST /api/bookings/:id/release` | owner | Give held seats back |
| `GET /api/bookings`, `GET /api/bookings/:id` | owner | My bookings |
| `POST /api/bookings/:id/cancel` | owner | Cancel (≥ 2 h before the show) |
| `POST/PUT/DELETE /api/admin/movies[/:id]` | admin | Movie management |
| `POST/PUT/DELETE /api/admin/shows[/:id]` | admin | Show management |
| `GET /api/admin/shows`, `GET /api/admin/shows/:id/bookings` | admin | Occupancy, revenue, booking list |

## Limitations and what I'd do next

* Logout discards the token in the browser; the JWT itself stays valid until it expires (stateless JWT). A token version or deny-list would fix that.
* No rate limiting on login/signup, and no email verification or password reset.
* The token lives in `localStorage`, which a cross-site-scripting bug could read. HttpOnly cookies plus CSRF protection would be stronger.
* SSE hub is single-process (see decision 9). The 5-second sweeper would need a lock if several API instances ran it (it is harmless but redundant).
* Desktop-first layout; usable on a phone but not tuned for it.
* No frontend automated tests; the booking rules are tested in the backend, and I checked the UI flows by driving a real browser.

## Folder layout

```
backend/   Express API (src/routes, src/services), db/schema.sql, tests/
frontend/  React + TypeScript app (src/pages, src/components)
docker-compose.yml, .env.example
```

## Recording script (3–5 minutes)

1. Log in as `customer@cinema.test` in one browser window and `customer2@cinema.test` in a private window; put them side by side.
2. Browse a movie, open a show, show the 8×10 seat map; try to pick a 7th seat (message appears).
3. Both users select seat **C4**, then click **Continue** in both windows at the same time: one gets the 5-minute hold and countdown, the other is told "Seat C4 was just taken". The other window's map updates by itself.
4. Winner: Pay → **Payment failure** → "Payment failed" → **Try again** → **Payment success** → confirmation with booking ID.
5. Show "My bookings", then cancel the booking (seat goes free in the other window).
6. Log in as admin: add a movie, add a show, try an overlapping show (error), open a show to see booked seats, percentage, revenue and bookings.
7. Show `npm test` passing in the terminal.
