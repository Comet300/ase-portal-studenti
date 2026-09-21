-- =============================================================================
-- The fused seat columns go, and a proposal that cannot be honoured gets a word
-- =============================================================================
-- Two changes, one file, and they are deliberately together: both are the
-- clean-up half of „a seat is counted per level and per study programme”, and
-- neither can fail on data. A DROP COLUMN always succeeds; WIDENING a CHECK
-- always succeeds. 0026 argued for splitting migrations so that one bad row
-- cannot take an unrelated table down with it — that argument is about files
-- which can abort on the data they find, and there is no such file here.
--
-- --- 1. `bachelor_seats` / `master_seats` -------------------------------------
--
-- 0019 replaced them with `bachelor_base` / `master_base` and left them behind
-- on purpose: „Dropping them in the same migration that starts reading the new
-- ones leaves no way back other than a restore if the cutover reads wrong on
-- day one.” Eight releases have passed and the cutover held. Nothing in the
-- application has read these two columns since — `teacherCapacities` in
-- `src/lib/repo.ts` is the single reader of capacity and it reads the bases —
-- and the last screen that did, `/profesor/departament`, was moved off them in
-- 3f93866.
--
-- WHAT KEPT THEM DANGEROUS. `scripts/seed.mjs` still WROTE them, so a seeded
-- database carried nine rows of authoritative-looking numbers that the portal
-- ignored completely: every coordinator was silently on the year's norm, and
-- the seed's own „a supervisor with every seat taken” demo state — written by
-- setting `bachelor_seats` to the number already taken — produced a supervisor
-- who was not full at all. A column that lies is worse than a column that is
-- missing, because it answers when it is asked. The seed writes the bases from
-- this release on; the columns go here so the two cannot part company again.
--
-- The TypeScript fields `bachelor_seats` / `master_seats` in `src/lib/repo.ts`
-- are NOT these columns and are not touched: they are computed from
-- `Capacity.total`, that is base + live extras, and they are what „x din y” is
-- written against on the coordinator's own screens.
--
-- The CHECK constraints go with the columns — Postgres drops a constraint whose
-- only column disappears — and there is no index, no foreign key and no view on
-- either of them to find first.
--
-- Dropped outright, with no copy kept and no guard over what they hold: the
-- deployed database carries test data only and may be thrown away, so the sole
-- contract left is that a fresh database comes up correctly from 0001 to head.
-- Anything written to defend rows that nobody wants back would be ceremony.

ALTER TABLE seat_allocations
  DROP COLUMN bachelor_seats,
  DROP COLUMN master_seats;

-- --- 2. a word for a proposal that has run out of seats -----------------------
--
-- A coordinator may send more proposals than they have seats, and should be
-- able to: not everybody accepts. What must never happen — and did, until this
-- release — is one of them becoming an approved supervision anyway, because
-- `/api/cereri/depune` skipped the seat check for an invited student.
--
-- With that gate closed, somebody has to be told, and it is the coordinator:
-- they are the only person who can act, by asking the director for a seat for
-- that programme or withdrawing another proposal. The student cannot, and the
-- refusal is not their doing.
--
-- It is an EVENT and not just an email because the thread is where this portal
-- keeps what happened between two people, it is what the notification bell
-- reads, and it is what makes the notice sayable exactly once: `postEvent`
-- writes it against the invitation's id, and `tellCoordinatorSeatIsGone` looks
-- for that row before sending anything a second time. A new column on
-- `invitations` would have been the other way to remember it, for a fact the
-- thread already remembers.
--
-- As in 0016: the whole list is restated, nothing is dropped. A value in use
-- would take its rows with it, and a thread is read a year later. The list
-- copied here is 0022's, which is the last one to have widened it — copying
-- 0016's, the file that explains the rule, would have silently dropped
-- `thesis_uploaded` and with it every „Lucrare încărcată” notification.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_event_type_check;

ALTER TABLE messages ADD CONSTRAINT messages_event_type_check
  CHECK (event_type IN (
    -- as in 0006, 0016 and 0022, unchanged
    'request_approved', 'request_rejected', 'request_expired', 'request_withdrawn',
    'invitation_sent', 'invitation_accepted', 'invitation_declined',
    'consultation_scheduled', 'consultation_cancelled', 'seats_granted',
    'coordination_ended',
    'change_requested', 'change_approved', 'change_rejected', 'change_applied',
    'thesis_uploaded',

    -- A proposal this coordinator can no longer honour. Not „refused” and not
    -- „expired”: the student said yes and the proposal is still open, which is
    -- exactly why it needs its own word — the other two would both read as a
    -- decision somebody made, and nobody made this one.
    'invitation_no_seat'
  ));
