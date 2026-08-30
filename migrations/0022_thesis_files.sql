-- =============================================================================
-- The thesis itself, handed in through the portal
-- =============================================================================
-- The regulation the portal prints says „Lucrarea se încarcă în portal în
-- format PDF, împreună cu declarația de originalitate semnată”, and the guide
-- tells the student to email the final form to their coordinator, who uploads
-- it to the university's anti-plagiarism platform. The first sentence described
-- something that did not exist; the second described the workaround.
--
-- `files` already stores everything a file needs — who uploaded it, its real
-- name, the name on disk, its type and its size. What it could not say is what
-- a file IS: every row hangs off a conversation and a message, so a thesis had
-- to be an attachment in a chat, indistinguishable from the fourth draft of
-- chapter two.
--
-- Two columns settle it. `request_id` says which supervision the file belongs
-- to — the request row *is* the thesis in this schema, carrying its title, its
-- objectives, its coordinator and, in the end, its grade. `kind` says what it
-- is: an attachment in a conversation, the thesis, or the signed declaration of
-- originality that travels with it.
ALTER TABLE files
  ADD COLUMN IF NOT EXISTS request_id uuid REFERENCES requests(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'attachment';

ALTER TABLE files DROP CONSTRAINT IF EXISTS files_kind_check;

ALTER TABLE files ADD CONSTRAINT files_kind_check
  CHECK (kind IN ('attachment', 'thesis', 'declaration'));

-- A file is either an attachment in a conversation or a document of a thesis.
-- Neither is optional for its own kind: an attachment with no conversation is
-- unreachable — every read path joins through `conversations` — and a thesis
-- with no request belongs to nobody's supervision.
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_belongs_somewhere;

ALTER TABLE files ADD CONSTRAINT files_belongs_somewhere
  CHECK (
    (kind = 'attachment' AND conversation_id IS NOT NULL)
    OR (kind <> 'attachment' AND request_id IS NOT NULL)
  );

-- „The current thesis” is the newest row of its kind, and the history stays.
-- A student who uploads a corrected form the evening before the deadline has
-- not deleted the one from last week — the coordinator may have read it, and
-- „which version did I read” is a question with consequences.
CREATE INDEX IF NOT EXISTS idx_files_request
  ON files (request_id, kind, created_at DESC)
  WHERE request_id IS NOT NULL;

-- =============================================================================
-- The handing-in, in the pair's thread
-- =============================================================================
-- Everything the portal does to a supervision is written in the thread between
-- the two people, as a record rather than as somebody typing: the decision, the
-- invitation, the scheduled consultation, the change of title. Handing in the
-- thesis is the largest of them and had nowhere to be written.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_event_type_check;

ALTER TABLE messages ADD CONSTRAINT messages_event_type_check
  CHECK (event_type IN (
    -- as in 0016, unchanged
    'request_approved', 'request_rejected', 'request_expired', 'request_withdrawn',
    'invitation_sent', 'invitation_accepted', 'invitation_declined',
    'consultation_scheduled', 'consultation_cancelled', 'seats_granted',
    'coordination_ended',
    'change_requested', 'change_approved', 'change_rejected', 'change_applied',

    -- The student uploaded the thesis, or a new version of it. One verb for
    -- both: the second upload is the same act, and the row carries the date
    -- that tells them apart.
    'thesis_uploaded'
  ));

-- The subject of the event is the file, so the notification can lead to the
-- document rather than to the middle of a conversation.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_subject_kind_check;

ALTER TABLE messages ADD CONSTRAINT messages_subject_kind_check
  CHECK (subject_kind IN ('request', 'invitation', 'slot', 'change', 'file'));
