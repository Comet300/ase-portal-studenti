-- People enter and leave the portal.
--
-- Until now they did neither: the only `INSERT INTO users` in the whole project
-- was in `scripts/seed.mjs`, so a cohort was populated by running a script on
-- production, and a graduate or a retired teacher kept an active account
-- indefinitely. The email address could not be corrected either, and signing in
-- is exclusively through a link sent to it — one wrong letter meant a person
-- shut out for good.
--
-- Deactivation, not deletion: their requests, decisions and papers stay in the
-- academic register, whose whole point is that it can be read years later. Only
-- access is closed, and `deactivated_at` says since when.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_active      boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  -- Who brought them into the portal. NULL for seed rows and for the migration.
  ADD COLUMN IF NOT EXISTS created_by     uuid REFERENCES users(id) ON DELETE SET NULL;

-- Looking up by email is now also the way duplicates are checked when adding
-- someone, so it is worth making it cheap and insensitive to capital letters.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));

-- The sessions of a deactivated person must not survive the deactivation.
-- Deleting them is part of the operation, not a later cleanup.
