-- =============================================================================
-- Consultations for the whole university, and consultations for your own
-- =============================================================================
-- Every hour in this table is, today, for the coordinator's own students: the
-- student screen requires an approved request with that teacher before it shows
-- a slot, and `/api/rezervari` requires the same before it books one. That was
-- never written down as a property of the row — it lived in two WHERE clauses,
-- in two files.
--
-- It has to become a property of the row, because the other kind now exists.
-- A member of the teaching staff also holds office hours for the faculty at
-- large: the student who has a question about the guide, the one deciding whom
-- to ask for coordination, the one from another year. Until now the portal had
-- nowhere to put those, so they were arranged by email, which is exactly what
-- this portal exists to stop.
--
--   `audience = 'thesis'` — the students this person coordinates. Unchanged
--                           behaviour: they get the email when hours open, and
--                           nobody else sees the row.
--   `audience = 'public'`  — any signed-in student. Visible in the catalogue of
--                            open hours, bookable by whoever gets there first,
--                            and NOT emailed to anyone: a notice to eleven
--                            hundred students, every time a coordinator opens
--                            an afternoon, is not a notification, it is a
--                            reason to turn notifications off.
--
-- The default is `thesis` because that is what every existing row is. This is a
-- different axis from `kind` (0017): `kind` says whether the hour was published
-- for whoever books it or scheduled with named students, and a scheduled
-- meeting is always with your own — the endpoint writes `thesis` for it.
ALTER TABLE consultation_slots
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'thesis';

ALTER TABLE consultation_slots DROP CONSTRAINT IF EXISTS consultation_slots_audience_check;

ALTER TABLE consultation_slots ADD CONSTRAINT consultation_slots_audience_check
  CHECK (audience IN ('public', 'thesis'));

-- The student screen now asks „which public hours are there, anywhere in the
-- faculty”, which is a question no index answered: the existing one starts with
-- the teacher.
CREATE INDEX IF NOT EXISTS idx_slots_audience
  ON consultation_slots (audience, starts_at)
  WHERE is_cancelled = false;
