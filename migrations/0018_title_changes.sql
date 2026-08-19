-- =============================================================================
-- Changing the title or the objectives of a thesis that has already been agreed
-- =============================================================================
-- There is no `theses` table: the agreed thesis IS the approved `requests` row,
-- carrying `title_ro`, `title_en` and `objectives`. Until now those three
-- columns were written in exactly one statement in the whole application — the
-- INSERT in `/api/cereri/depune` — so a title agreed in October could not be
-- corrected in March by anybody, through any screen.
--
-- WHY A SIDE TABLE AND NOT A STATUS ON `requests`
--
-- The obvious shape is `status = 'change_pending'`. It cannot be used. Roughly
-- fifteen statements filter on `status = 'approved'`: the seat count
-- (`seatColumns`), the supervised roster, the pairings list, the chat's
-- `PAIRING_LIVE` test, the archive, the printable request document. A student
-- with a pending title change would drop out of every one of them at once —
-- seat freed, thread read-only, document 404 — and come back when the
-- coordinator got round to answering. The supervision stays `approved` for the
-- whole of the flow; the request to change it lives here.
--
-- WHY `old_*` AND `new_*` ON THE SAME ROW
--
-- This table is also the history. With both halves stored, every title the
-- thesis ever had is `SELECT ... FROM title_changes WHERE request_id = $1
-- ORDER BY created_at` — including the ones the coordinator applied directly,
-- which are written here too rather than being an invisible UPDATE. The
-- snapshot is taken inside the INSERT, from the request row itself, so it
-- cannot drift from what was actually on screen.
-- =============================================================================

CREATE TABLE IF NOT EXISTS title_changes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,

  -- The student asks; the coordinator applies directly. Which of the two it was
  -- is read from this against `requests.student_id`, so no second column can
  -- disagree with it.
  requested_by   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  old_title_ro   text NOT NULL,
  old_title_en   text,
  old_objectives text NOT NULL,

  new_title_ro   text NOT NULL,
  new_title_en   text,
  new_objectives text NOT NULL,

  -- Why the change is asked for. Optional when the coordinator applies their
  -- own edit: they are the one who would have had to be convinced.
  reason         text,

  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),

  -- Never `requests.decision_note`: that column already holds the message sent
  -- when the coordination itself was accepted, and the student's screen renders
  -- it as „Mesaj de la coordonator”. Writing a change decision there would
  -- destroy the original one.
  decision_note  text,
  decided_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- The history read: everything about one thesis, newest first.
CREATE INDEX IF NOT EXISTS idx_title_changes_request
  ON title_changes (request_id, created_at DESC);

-- The coordinator's queue.
CREATE INDEX IF NOT EXISTS idx_title_changes_open
  ON title_changes (status, created_at DESC) WHERE status = 'pending';

-- One open change per thesis. The same device as `idx_seat_requests_one_open`
-- (0002) and `idx_requests_one_active` (0001): a second request while the first
-- is undecided is not a queue, it is two people editing the same three columns
-- from opposite ends, and the second decision would silently undo the first.
CREATE UNIQUE INDEX IF NOT EXISTS idx_title_changes_one_open
  ON title_changes (request_id) WHERE status = 'pending';

-- The event vocabulary (`change_requested`, `change_approved`, `change_rejected`,
-- `change_applied`) and `subject_kind = 'change'` were already widened in
-- 0016_event_vocabulary.sql, deliberately ahead of this table: `postEvent`
-- swallows a CHECK violation, so a value outside the constraint is a feature
-- that appears to work and notifies nobody.
