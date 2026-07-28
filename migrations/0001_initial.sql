-- =============================================================================
-- Portal Studenți — initial schema
-- =============================================================================
-- No extensions: gen_random_uuid() ships with PostgreSQL 13+, so this applies
-- to a stock image.
--
-- Authorization lives in the application, not in row-level security: every
-- owner-scoped statement carries its condition inline.
-- =============================================================================

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL UNIQUE,
  name              text NOT NULL,
  role              text NOT NULL CHECK (role IN ('student', 'teacher', 'head')),

  -- student
  student_number    text,
  program           text CHECK (program IN ('bachelor', 'master')),
  specialization    text,
  study_year        integer,

  -- teacher
  academic_title    text,
  department        text,
  bachelor_capacity integer NOT NULL DEFAULT 0,
  master_capacity   integer NOT NULL DEFAULT 0,
  office            text,
  is_demo           boolean NOT NULL DEFAULT false,

  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_role ON users (role);

-- --- authentication ----------------------------------------------------------

-- The token reaches the user by email; only its digest is stored, so reading
-- this table authenticates nobody.
CREATE TABLE magic_link_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  redirect_to text,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_magic_link_expires ON magic_link_tokens (expires_at);

CREATE TABLE sessions (
  id         text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user ON sessions (user_id);

-- --- session calendar --------------------------------------------------------

CREATE TABLE session_stages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position       integer NOT NULL,
  title          text NOT NULL,
  description    text,
  interval_label text NOT NULL,
  starts_on      date,
  ends_on        date
);

-- --- proposed topics ---------------------------------------------------------

CREATE TABLE topics (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         text NOT NULL,
  description   text,
  level         text NOT NULL CHECK (level IN ('bachelor', 'master')),
  methods       text,
  prerequisites text,
  seats         integer NOT NULL DEFAULT 1,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_topics_teacher ON topics (teacher_id);

-- --- supervision requests ----------------------------------------------------

CREATE TABLE requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number           text NOT NULL UNIQUE,
  student_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id         uuid REFERENCES topics(id) ON DELETE SET NULL,
  title_ro         text NOT NULL,
  title_en         text,
  objectives       text NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
  rejection_reason text,
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_requests_student ON requests (student_id);
CREATE INDEX idx_requests_teacher ON requests (teacher_id, status);

-- A student can only have one live request at a time.
CREATE UNIQUE INDEX idx_requests_one_active
  ON requests (student_id) WHERE status IN ('pending', 'approved');

-- --- milestones (the editable timeline) --------------------------------------

CREATE TABLE milestones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  due_on      date,
  status      text NOT NULL DEFAULT 'planned'
              CHECK (status IN ('planned', 'in_progress', 'done')),
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_milestones_request ON milestones (request_id, position);

-- --- consultations -----------------------------------------------------------

CREATE TABLE consultation_slots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  mode         text NOT NULL DEFAULT 'in_person' CHECK (mode IN ('in_person', 'online')),
  location     text,
  meeting_url  text,
  capacity     integer NOT NULL DEFAULT 1,
  is_cancelled boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_slots_teacher ON consultation_slots (teacher_id, starts_at);

CREATE TABLE bookings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id    uuid NOT NULL REFERENCES consultation_slots(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject    text,
  status     text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_id, student_id)
);

CREATE INDEX idx_bookings_student ON bookings (student_id);

-- --- messaging ---------------------------------------------------------------

CREATE TABLE conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_message_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, teacher_id)
);

CREATE INDEX idx_conversations_teacher ON conversations (teacher_id, last_message_at DESC);
CREATE INDEX idx_conversations_student ON conversations (student_id, last_message_at DESC);

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            text NOT NULL,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation ON messages (conversation_id, created_at);

-- --- attachments -------------------------------------------------------------

CREATE TABLE files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      uuid REFERENCES messages(id) ON DELETE CASCADE,
  original_name   text NOT NULL,
  stored_name     text NOT NULL,
  mime            text,
  size_bytes      bigint,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_files_conversation ON files (conversation_id);
