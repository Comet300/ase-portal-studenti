-- =============================================================================
-- Seats: a base per coordinator, extras earmarked per study programme, and a
-- ledger that says who gave what to whom, when and why
-- =============================================================================
-- Until now capacity was two integers on `seat_allocations`, and two different
-- code paths wrote the same integer: `/api/locuri?actiune=aloca` overwrote it
-- (`= EXCLUDED`), `grantSeats` added to it (`= column + EXCLUDED`). After one
-- grant followed by one manual save nothing in the database could say how many
-- of a coordinator's seats were the department's norm and how many were extras
-- the director had handed out. There was also no programme anywhere in the
-- model, so an extra granted „for Marketing” was spendable by anyone.
--
-- WHY THE EXISTING NUMBERS ARE NOT UN-FUSED
--
-- The obvious move is to subtract the approved `seat_requests` back out of
-- `bachelor_seats` to recover the base. It is not sound: `updated_at` is a
-- single timestamp shared by both write paths, so there is no way to tell
-- whether a later manual save had already replaced the granted total. Half the
-- department would silently lose seats they currently have. Instead the whole
-- current value becomes the base — every coordinator keeps exactly the capacity
-- they had the minute before this ran — and the already-granted extras are
-- written into the ledger as revoked-at-migration, so the record exists without
-- being counted a second time.
--
-- WHY THE EARMARK IS STRICT
--
-- A seat granted for Marketing can only be filled by a Marketing student. That
-- is the department's decision, and it has one large consequence the rest of
-- the portal has to carry: „full” stops being a property of a coordinator and
-- becomes a property of (coordinator, programme). See `src/lib/seats.ts` for
-- the charging rule that follows from it.
-- =============================================================================

-- --- the norm: what a coordinator gets before anybody decides otherwise ------

-- The norm belongs to the year, not to a settings singleton: seats already
-- reset with the year (see 0002), and the norm is exactly what the department
-- renegotiates each autumn. A coordinator hired in March now starts on the norm
-- instead of on zero — until today they had no allocation row at all and could
-- not take a single student until the director typed a number by hand.
ALTER TABLE academic_years
  ADD COLUMN default_bachelor_seats integer NOT NULL DEFAULT 5
    CHECK (default_bachelor_seats BETWEEN 0 AND 40),
  ADD COLUMN default_master_seats integer NOT NULL DEFAULT 3
    CHECK (default_master_seats BETWEEN 0 AND 40);

-- --- the base: the norm, or this coordinator's own number --------------------

-- New columns rather than a reuse of `bachelor_seats`: those hold base+extras
-- fused together, and `NOT NULL DEFAULT 0` cannot express „this one is on the
-- norm”. NULL is that statement, and it is the difference between a coordinator
-- nobody has decided about and a coordinator decided to have none.
--
-- The ceiling is 99 and not the 40 the director's form offers: a value fused by
-- the old code can already be above 40, and a CHECK that refused it would abort
-- this migration on exactly the installations that need it most. 40 stays the
-- limit on what can be typed; see SEAT_BASE_MAX in `src/lib/seats.ts`.
ALTER TABLE seat_allocations
  ADD COLUMN bachelor_base integer CHECK (bachelor_base BETWEEN 0 AND 99),
  ADD COLUMN master_base   integer CHECK (master_base   BETWEEN 0 AND 99);

UPDATE seat_allocations
   SET bachelor_base = bachelor_seats,
       master_base   = master_seats;

-- `bachelor_seats` / `master_seats` stay behind, unread from this release on.
-- Dropping them in the same migration that starts reading the new ones leaves
-- no way back other than a restore if the cutover reads wrong on day one.

-- --- a programme is addressable together with its year -----------------------

-- Needed by the composite foreign keys below, which are what stops an extra
-- being earmarked for a programme belonging to a different academic year.
ALTER TABLE study_programmes
  ADD CONSTRAINT study_programmes_id_year_key UNIQUE (id, academic_year_id);

-- --- the ledger --------------------------------------------------------------

-- One row per act of giving. It answers the whole question the department asked
-- for: when (`granted_at`), how many (`seats`), by whom (`granted_by`), to whom
-- (`teacher_id`), for which programme (`programme_id` + `level`), why
-- (`reason`), and on which written request if there was one.
CREATE TABLE seat_grants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  teacher_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- The programme the seats are reserved for. NULL only on the rows migrated
  -- out of the old fused allocations, where the programme was never recorded
  -- and must not be invented. Those rows arrive revoked.
  programme_id     uuid,

  level            text NOT NULL CHECK (level IN ('bachelor', 'master')),
  seats            integer NOT NULL CHECK (seats BETWEEN 1 AND 20),
  reason           text NOT NULL,

  -- The written request, when there was one. NULL = the director's own move.
  seat_request_id  uuid REFERENCES seat_requests(id) ON DELETE SET NULL,
  granted_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at       timestamptz NOT NULL DEFAULT now(),

  -- Taking seats back does not delete the row: the ledger has to stay readable
  -- years later, including the parts somebody changed their mind about.
  revoked_at       timestamptz,
  revoked_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  revoke_reason    text,

  -- MATCH SIMPLE: with `programme_id` NULL the pair is not checked at all,
  -- which is what lets the migrated rows in while every new grant is held to a
  -- programme of its own year.
  CONSTRAINT seat_grants_programme_year_fkey
    FOREIGN KEY (programme_id, academic_year_id)
    REFERENCES study_programmes (id, academic_year_id) ON DELETE RESTRICT
);

-- The live sum, which every capacity read starts from.
CREATE INDEX idx_seat_grants_live
  ON seat_grants (teacher_id, academic_year_id, level) WHERE revoked_at IS NULL;
-- „What did this programme receive, and when” — the director's ledger panel.
CREATE INDEX idx_seat_grants_programme ON seat_grants (programme_id, granted_at DESC);
CREATE INDEX idx_seat_grants_when ON seat_grants (academic_year_id, granted_at DESC);

-- Changing the base is a decision too, and until now it left one overwritten
-- integer and a timestamp: no before-value, no reason, nothing to read back.
CREATE TABLE seat_base_changes (
  id               bigserial PRIMARY KEY,
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  teacher_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level            text NOT NULL CHECK (level IN ('bachelor', 'master')),
  seats_before     integer,   -- NULL = was on the norm
  seats_after      integer,   -- NULL = put back on the norm
  note             text,
  changed_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  changed_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_seat_base_changes_when
  ON seat_base_changes (academic_year_id, changed_at DESC);

-- --- asking for extras names a programme -------------------------------------

ALTER TABLE seat_requests
  ADD COLUMN programme_id uuid,
  ADD CONSTRAINT seat_requests_programme_year_fkey
    FOREIGN KEY (programme_id, academic_year_id)
    REFERENCES study_programmes (id, academic_year_id) ON DELETE RESTRICT;

-- One open request per programme, not per level. A coordinator who needs two
-- seats for „Marketing MA (en)” and one for „Cercetări de marketing” — both
-- master — could previously only have one of the two asks open at a time.
-- COALESCE, because the requests already in the queue carry no programme.
DROP INDEX idx_seat_requests_one_open;
CREATE UNIQUE INDEX idx_seat_requests_one_open
  ON seat_requests (teacher_id, academic_year_id, level,
                    COALESCE(programme_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'pending';

-- --- which programme a seat was actually spent on ----------------------------

-- Read off `users.programme_id` at query time until now, which means the head
-- moving a student between programmes in March retroactively moved a seat
-- consumed in October from one pot to another. Pinned at decision time instead.
ALTER TABLE requests
  ADD COLUMN programme_id uuid REFERENCES study_programmes(id) ON DELETE SET NULL;

-- Today's value, not the value at approval time — for students already moved
-- the true answer is unrecoverable, and inventing one would be worse than a
-- number the director can see and correct.
UPDATE requests r
   SET programme_id = s.programme_id
  FROM users s
 WHERE s.id = r.student_id AND r.programme_id IS NULL;

CREATE INDEX idx_requests_programme
  ON requests (teacher_id, programme_id) WHERE status IN ('approved', 'defended');

-- --- the extras already granted, written down for the record -----------------

-- These seats are inside the base copied above, so counting them live would
-- hand every coordinator their extras twice. They arrive revoked at the instant
-- they were decided: the history is readable, the arithmetic is untouched.
INSERT INTO seat_grants (academic_year_id, teacher_id, programme_id, level, seats,
                         reason, seat_request_id, granted_by, granted_at,
                         revoked_at, revoked_by, revoke_reason)
SELECT sr.academic_year_id, sr.teacher_id, NULL, sr.level, sr.extra_seats,
       sr.reason, sr.id, sr.decided_by, COALESCE(sr.decided_at, sr.created_at),
       COALESCE(sr.decided_at, sr.created_at), sr.decided_by,
       'Inclus în baza de locuri la trecerea pe evidența separată'
  FROM seat_requests sr
 WHERE sr.status = 'approved';
