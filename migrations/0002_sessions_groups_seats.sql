-- =============================================================================
-- Portal Studenți — academic years, study groups, seats, invitations, archive
-- =============================================================================
-- The first schema assumed a single, permanent session. This one makes the
-- academic year an explicit object, because the faculty starts each year from a
-- blank slate: new calendar, new topic catalogue, new seat allocations — while
-- people, past pairings and the archive carry over.
--
-- Same rule as before: no row-level security. Every owner-scoped statement
-- carries its condition inline.
-- =============================================================================

-- --- academic year -----------------------------------------------------------

CREATE TABLE academic_years (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text NOT NULL UNIQUE,          -- „2025–2026”
  starts_on  date NOT NULL,
  ends_on    date NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Exactly one year can be current; opening a new one closes the previous.
CREATE UNIQUE INDEX idx_years_one_current ON academic_years ((is_current)) WHERE is_current;

-- Everything already in the database belongs to the session that is running now.
INSERT INTO academic_years (label, starts_on, ends_on, is_current)
VALUES (
  (EXTRACT(YEAR FROM current_date - interval '6 months')::int)::text || '–' ||
  (EXTRACT(YEAR FROM current_date + interval '6 months')::int)::text,
  date_trunc('year', current_date - interval '6 months')::date,
  (date_trunc('year', current_date + interval '6 months') + interval '1 year - 1 day')::date,
  true
);

-- --- study programmes (the grouping the director owns) -----------------------

-- A student belongs to exactly one programme, and a programme is the tuple the
-- faculty actually groups by: level, name, language of instruction.
CREATE TABLE study_programmes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  level            text NOT NULL CHECK (level IN ('bachelor', 'master')),
  name             text NOT NULL,
  language         text NOT NULL DEFAULT 'ro' CHECK (language IN ('ro', 'en', 'fr', 'de')),
  duration_years   integer NOT NULL DEFAULT 3,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (academic_year_id, level, name, language)
);

CREATE INDEX idx_programmes_year ON study_programmes (academic_year_id, level);

-- --- people ------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN programme_id   uuid REFERENCES study_programmes(id) ON DELETE SET NULL,
  ADD COLUMN study_language text NOT NULL DEFAULT 'ro' CHECK (study_language IN ('ro', 'en', 'fr', 'de')),
  ADD COLUMN study_group    text,
  -- profile
  ADD COLUMN bio            text,
  ADD COLUMN avatar_path    text,
  ADD COLUMN interests      text,   -- teacher: research directions; student: areas of interest
  ADD COLUMN website        text;

CREATE INDEX idx_users_programme ON users (programme_id);

-- --- seats: allocated by the director, per year ------------------------------

-- Capacity used to live on `users` and be edited by the teacher themselves.
-- The director is the authority, and the number resets with the year, so it
-- belongs to a (teacher, year) row instead.
CREATE TABLE seat_allocations (
  teacher_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  bachelor_seats   integer NOT NULL DEFAULT 0 CHECK (bachelor_seats >= 0),
  master_seats     integer NOT NULL DEFAULT 0 CHECK (master_seats >= 0),
  set_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, academic_year_id)
);

-- Carry the numbers the teachers had already declared into the current year.
INSERT INTO seat_allocations (teacher_id, academic_year_id, bachelor_seats, master_seats)
SELECT u.id, y.id, u.bachelor_capacity, u.master_capacity
  FROM users u, academic_years y
 WHERE u.role IN ('teacher', 'head') AND y.is_current;

ALTER TABLE users DROP COLUMN bachelor_capacity, DROP COLUMN master_capacity;

-- A teacher who runs out of seats asks the director for more, in writing.
CREATE TABLE seat_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  level            text NOT NULL CHECK (level IN ('bachelor', 'master')),
  extra_seats      integer NOT NULL CHECK (extra_seats BETWEEN 1 AND 20),
  reason           text NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decision_note    text,
  decided_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_seat_requests_status ON seat_requests (status, created_at DESC);

-- One open request per teacher and level, so the queue cannot be flooded.
CREATE UNIQUE INDEX idx_seat_requests_one_open
  ON seat_requests (teacher_id, academic_year_id, level) WHERE status = 'pending';

-- --- the year the rest of the data belongs to --------------------------------

ALTER TABLE session_stages
  ADD COLUMN academic_year_id uuid REFERENCES academic_years(id) ON DELETE CASCADE;
ALTER TABLE topics
  ADD COLUMN academic_year_id uuid REFERENCES academic_years(id) ON DELETE CASCADE,
  ADD COLUMN language text NOT NULL DEFAULT 'ro' CHECK (language IN ('ro', 'en', 'fr', 'de'));
ALTER TABLE requests
  ADD COLUMN academic_year_id uuid REFERENCES academic_years(id) ON DELETE CASCADE;

UPDATE session_stages SET academic_year_id = (SELECT id FROM academic_years WHERE is_current);
UPDATE topics         SET academic_year_id = (SELECT id FROM academic_years WHERE is_current);
UPDATE requests       SET academic_year_id = (SELECT id FROM academic_years WHERE is_current);

ALTER TABLE session_stages ALTER COLUMN academic_year_id SET NOT NULL;
ALTER TABLE topics         ALTER COLUMN academic_year_id SET NOT NULL;
ALTER TABLE requests       ALTER COLUMN academic_year_id SET NOT NULL;

CREATE INDEX idx_stages_year   ON session_stages (academic_year_id, position);
CREATE INDEX idx_topics_year   ON topics (academic_year_id, level, language);
CREATE INDEX idx_requests_year ON requests (academic_year_id, status);

-- --- invitations: the coordinator asks the student ---------------------------

CREATE TABLE invitations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  teacher_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id         uuid REFERENCES topics(id) ON DELETE SET NULL,
  message          text NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  response_reason  text,
  expires_at       timestamptz NOT NULL,
  responded_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_invitations_student ON invitations (student_id, status);
CREATE INDEX idx_invitations_teacher ON invitations (teacher_id, status);

-- The same teacher cannot pile up invitations on the same student.
CREATE UNIQUE INDEX idx_invitations_one_open
  ON invitations (teacher_id, student_id) WHERE status = 'pending';

-- --- requests: motivation, feedback, deadline, provenance --------------------

ALTER TABLE requests
  ADD COLUMN motivation    text,
  ADD COLUMN decision_note text,
  -- A request left undecided past this instant is auto-rejected: silence is not
  -- an answer a student can plan around.
  ADD COLUMN expires_at    timestamptz,
  ADD COLUMN invitation_id uuid REFERENCES invitations(id) ON DELETE SET NULL;

UPDATE requests SET expires_at = submitted_at + interval '7 days' WHERE status = 'pending';

ALTER TABLE requests DROP CONSTRAINT requests_status_check;
ALTER TABLE requests ADD CONSTRAINT requests_status_check
  CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'expired'));

CREATE INDEX idx_requests_expiring ON requests (expires_at) WHERE status = 'pending';

-- --- messages that are events, not chatter -----------------------------------

-- A decision reaches the student by email and in the thread. In the thread it
-- must not read like the coordinator typing „aprobat” — it is a record of what
-- the portal did, and it is rendered as one.
ALTER TABLE messages
  ADD COLUMN kind       text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'event')),
  ADD COLUMN event_type text CHECK (event_type IN (
    'request_approved', 'request_rejected', 'request_expired',
    'invitation_sent', 'invitation_accepted', 'invitation_declined',
    'consultation_scheduled', 'seats_granted'
  ));

-- --- consultations: who with, and exactly where -------------------------------

ALTER TABLE consultation_slots
  -- Set when the coordinator schedules a meeting with one named student rather
  -- than publishing an open interval.
  ADD COLUMN student_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN note       text;

CREATE INDEX idx_slots_invited ON consultation_slots (student_id) WHERE student_id IS NOT NULL;

-- --- archive of what happened before the portal ------------------------------

-- Pairings from previous years, typed in or imported by the director. Deliberately
-- free text rather than foreign keys: these people may have no account and never will.
CREATE TABLE archive_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  student_name     text NOT NULL,
  student_number   text,
  programme        text,
  level            text CHECK (level IN ('bachelor', 'master')),
  language         text,
  teacher_name     text NOT NULL,
  title_ro         text NOT NULL,
  defended_on      date,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_archive_year ON archive_entries (academic_year_id, student_name);
