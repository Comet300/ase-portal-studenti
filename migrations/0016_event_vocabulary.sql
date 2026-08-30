-- =============================================================================
-- The vocabulary of the events written into a thread
-- =============================================================================
-- `postEvent` never throws: every caller reaches it *after* committing the
-- decision it describes, so an exception there would turn a successful approval
-- into a 500. The cost of that is exact: an `event_type` outside this CHECK
-- produces no notification, no visible failure and one line in the container's
-- log. A feature that silently does nothing.
--
-- So the constraint is widened before anything writes the new values, not after.
--
-- The list below is the one from 0006_consultation_cancelled.sql, copied
-- verbatim and added to. Nothing is dropped: a value in use would take its rows
-- with it, and the thread is where a decision is looked for a year later.
-- =============================================================================

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_event_type_check;

ALTER TABLE messages ADD CONSTRAINT messages_event_type_check
  CHECK (event_type IN (
    -- as in 0006, unchanged
    'request_approved', 'request_rejected', 'request_expired', 'request_withdrawn',
    'invitation_sent', 'invitation_accepted', 'invitation_declined',
    'consultation_scheduled', 'consultation_cancelled', 'seats_granted',

    -- A supervision that ends the way it is supposed to. Entering the grade
    -- sets `requests.status = 'defended'`, which drops the pair out of the
    -- pairing test and turns the thread read-only from one second to the next
    -- — until now with nothing at all written in it saying so.
    'coordination_ended',

    -- A change to an approved thesis — the title, the objectives — asked for,
    -- decided and applied. Nothing writes these yet; they are here so that the
    -- wave which does is one insert rather than a migration plus a deployment.
    'change_requested', 'change_approved', 'change_rejected', 'change_applied'
  ));

-- The subject of an event says what exactly happened, so the notification can
-- lead to it rather than to the conversation. A change request is a subject of
-- its own: it lives neither on the request row nor on a consultation slot.
--
-- 0011 created the column with `ADD COLUMN IF NOT EXISTS`, so on a database
-- where the column already existed the constraint may never have been created.
-- Hence `IF EXISTS` — dropping what is not there must not stop the migration.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_subject_kind_check;

ALTER TABLE messages ADD CONSTRAINT messages_subject_kind_check
  CHECK (subject_kind IN ('request', 'invitation', 'slot', 'change'));
