-- Who a student is on paper, and whether their account was ever used.
--
-- Three facts the portal could not hold. The official name in the register is
-- „Popescu I. Maria” — the father's initial is part of it, not an ornament, and
-- every document printed from here left it out. The series sits between year
-- and group (programme > year > series > group) and could not be derived from
-- `study_group`: that column is free text typed by hand, with no format anybody
-- enforces. And a list of two hundred addresses pasted from a spreadsheet
-- always contains a few that nobody ever signed in with — a wrong letter in an
-- address is a person shut out, and until now the only way to notice was for
-- them to complain.
--
-- `first_login_at` is not `last_seen_at`. The latter is recent presence, is
-- overwritten on every navigation, and the privacy notice promises it is seen
-- by nobody outside a coordination. This one is written once, in `createSession`,
-- and answers a different question: was this account ever activated.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS father_initial text,
  ADD COLUMN IF NOT EXISTS study_series   text,
  ADD COLUMN IF NOT EXISTS first_login_at timestamptz;

-- Whoever was seen in the portal signed in at some point. This is the best
-- reconstruction available and it is knowingly incomplete: `last_seen_at`
-- itself only exists since 0013 and was never backfilled, so an account that
-- has not been back since then stays NULL and will read „never” on the first
-- day. The screens say so rather than presenting the gap as a fact.
UPDATE users
   SET first_login_at = last_seen_at
 WHERE first_login_at IS NULL AND last_seen_at IS NOT NULL;

-- The catalogue is read by cohort: the faculty screen filters programme, year,
-- series and group together, and only (programme_id) and (role) were indexed.
CREATE INDEX IF NOT EXISTS idx_users_cohort
  ON users (programme_id, study_year, study_series, study_group);
