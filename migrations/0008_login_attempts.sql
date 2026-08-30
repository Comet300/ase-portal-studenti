-- How many sign-in links have been asked for, and from where.
--
-- The form had no limit at all: every press sent a new email and created a new
-- token. With somebody else's address, anyone could fill an institutional
-- mailbox; with no ill intent, an impatient user did the same thing on a small
-- scale and received five identical messages.
--
-- The IP is kept as well, so that a single source cannot try address after
-- address. The rows are deleted after one day — this is a rate limit, not an
-- audit log, and a public university portal has no reason to hold on to IP
-- addresses longer than it needs to.

CREATE TABLE login_attempts (
  id         bigserial   PRIMARY KEY,
  email      text        NOT NULL,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_login_attempts_email ON login_attempts (email, created_at DESC);
CREATE INDEX idx_login_attempts_ip    ON login_attempts (ip, created_at DESC);
