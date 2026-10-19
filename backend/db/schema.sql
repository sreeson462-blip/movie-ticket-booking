-- Movie Ticket Booking: PostgreSQL schema (idempotent: safe to run repeatedly)
-- One cinema, one screen => shows are globally non-overlapping.

CREATE TABLE IF NOT EXISTS users (
  id            serial PRIMARY KEY,
  name          text        NOT NULL,
  email         text        NOT NULL,
  password_hash text        NOT NULL,                       -- bcrypt, never plain text
  role          text        NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Case-insensitive uniqueness: "A@x.com" and "a@x.com" are the same account.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq ON users (lower(email));

CREATE TABLE IF NOT EXISTS movies (
  id               serial PRIMARY KEY,
  title            text        NOT NULL,
  description      text        NOT NULL DEFAULT '',
  language         text        NOT NULL,
  duration_minutes int         NOT NULL CHECK (duration_minutes BETWEEN 1 AND 600),
  rating           text        NOT NULL CHECK (rating IN ('U', 'UA', 'A')),
  poster_url       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shows (
  id         serial PRIMARY KEY,
  movie_id   int         NOT NULL REFERENCES movies (id) ON DELETE RESTRICT,
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL,                          -- starts_at + movie duration
  price      int         NOT NULL CHECK (price >= 0),       -- whole rupees per seat (integers: no float rounding bugs)
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  -- The database itself refuses two shows whose [start, end) time ranges overlap.
  CONSTRAINT shows_no_overlap EXCLUDE USING gist (tstzrange(starts_at, ends_at, '[)') WITH &&)
);
CREATE INDEX IF NOT EXISTS shows_starts_at_idx ON shows (starts_at);
CREATE INDEX IF NOT EXISTS shows_movie_idx ON shows (movie_id);

-- A booking is created as a 5-minute HOLD ('held') and becomes 'confirmed' after successful payment.
CREATE TABLE IF NOT EXISTS bookings (
  id              text        PRIMARY KEY,                  -- public, human friendly: BK-XXXXXXXX
  user_id         int         NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  show_id         int         NOT NULL REFERENCES shows (id) ON DELETE RESTRICT,
  status          text        NOT NULL CHECK (status IN ('held', 'confirmed', 'cancelled', 'expired', 'released')),
  amount          int         NOT NULL CHECK (amount >= 0),
  hold_expires_at timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  confirmed_at    timestamptz,
  cancelled_at    timestamptz,
  UNIQUE (id, show_id)                                      -- lets booking_seats carry show_id safely
);
CREATE INDEX IF NOT EXISTS bookings_user_idx ON bookings (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_show_status_idx ON bookings (show_id, status);

CREATE TABLE IF NOT EXISTS booking_seats (
  booking_id  text    NOT NULL,
  show_id     int     NOT NULL,
  row_label   text    NOT NULL CHECK (row_label ~ '^[A-H]$'),
  seat_number int     NOT NULL CHECK (seat_number BETWEEN 1 AND 10),
  active      boolean NOT NULL DEFAULT true,                -- false once the hold expired / was released / booking cancelled
  PRIMARY KEY (booking_id, row_label, seat_number),
  FOREIGN KEY (booking_id, show_id) REFERENCES bookings (id, show_id) ON DELETE CASCADE
);
-- THE double-booking guard: at most ONE active claim per seat per show, enforced by PostgreSQL.
CREATE UNIQUE INDEX IF NOT EXISTS booking_seats_one_active_claim
  ON booking_seats (show_id, row_label, seat_number) WHERE active;

CREATE TABLE IF NOT EXISTS payments (
  id         serial PRIMARY KEY,
  booking_id text        NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  status     text        NOT NULL CHECK (status IN ('success', 'failed')),
  amount     int         NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
