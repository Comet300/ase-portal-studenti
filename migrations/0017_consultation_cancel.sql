-- =============================================================================
-- Cancelling a consultation, and telling an open hour from a summoned one
-- =============================================================================
-- Until now the whole of a cancellation was one boolean. `is_cancelled` says
-- that it happened and nothing else: not why, not when, not by whom — so the
-- student who got the email a week ago and the one whose consultation was
-- called off eleven minutes before it started read exactly the same row, and
-- „de ce” could only be answered from the mailbox of whoever was there.
--
-- The reason is not decoration. It is the sentence the coordinator writes once
-- and that the portal repeats in the email, in the thread and on the schedule,
-- so that four students do not each write asking the same question.
ALTER TABLE consultation_slots
  ADD COLUMN IF NOT EXISTS cancelled_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at     timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by     uuid REFERENCES users(id) ON DELETE SET NULL;

-- The rows cancelled before today keep their `NULL`s. The moment was never
-- written down, and a made-up one — `created_at`, or now() — would read on the
-- screen as a fact. The pages say „anulată”, without a date, exactly for these.

-- --- open hour or summoned meeting -------------------------------------------
-- Two things are created in the same table and were told apart by a column that
-- cannot do it: `student_id` names a single invitee, and the endpoint sets it
-- only when exactly one student was picked. A meeting scheduled with three
-- students therefore leaves it NULL — identical, row for row, to an open
-- three-seat hour that happened to fill up. The schedule could not label them,
-- and the student's screen could not say „programată de coordonator” for the
-- group case.
--
-- `open` is the default because that is what the older, larger half of the
-- table is: hours published for whoever books first.
ALTER TABLE consultation_slots
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'open';

ALTER TABLE consultation_slots DROP CONSTRAINT IF EXISTS consultation_slots_kind_check;

ALTER TABLE consultation_slots ADD CONSTRAINT consultation_slots_kind_check
  CHECK (kind IN ('open', 'scheduled'));

-- The backfill is a reconstruction, and it is knowingly imperfect — the fact it
-- recovers was never recorded, so it is inferred from three traces the two
-- endpoints leave behind:
--
--   * `student_id` is set only by the scheduling path, for a single invitee;
--   * `note` — the subject typed by the coordinator — is written only by that
--     same path; publishing open hours never fills it;
--   * a scheduled group meeting is booked full in the same statement that
--     creates it, so every one of its bookings is as old as the slot itself,
--     while an open hour is booked by students minutes or days later.
--
-- A group meeting with no subject, created before this migration, whose seats
-- were all taken within five seconds of publishing, stays `open`. That is the
-- one case that cannot be told apart, and it mislabels a row rather than
-- inventing a booking.
UPDATE consultation_slots s
   SET kind = 'scheduled'
 WHERE s.kind = 'open'
   AND (
     s.student_id IS NOT NULL
     OR s.note IS NOT NULL
     OR (
       s.capacity > 1
       AND (SELECT count(*) FROM bookings b WHERE b.slot_id = s.id) = s.capacity
       AND NOT EXISTS (
         SELECT 1 FROM bookings b
          WHERE b.slot_id = s.id AND b.created_at > s.created_at + interval '5 seconds'
       )
     )
   );
