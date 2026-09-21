-- =============================================================================
-- A live granted seat names the programme it is reserved for
-- =============================================================================
-- 0019 reserved every extra seat to one study programme — „a seat granted for
-- Marketing can only be filled by a Marketing student” — and `freeFor` in
-- `src/lib/seats.ts` spends a pot only for a student whose `programme_id`
-- equals the pot's. A pot with `programme_id IS NULL` therefore matches no
-- student who exists: the director hands out the seats, the ledger shows them,
-- `free_any` counts them, and not one coordinator can accept anybody with them.
--
-- 0019 created such rows on purpose, for the extras it folded back into the
-- base, and it created them ALREADY REVOKED — the history stays readable and
-- the arithmetic never counts them twice. Those rows are correct. They are why
-- `programme_id` is nullable at all, and why this is a CHECK over two columns
-- rather than a NOT NULL: „no programme” remains sayable about the past and
-- becomes unsayable about the present.
--
-- WHY A SEPARATE MIGRATION FROM 0025. Each file runs in its own transaction.
-- 0025 creates the teaching-centre table every programme now depends on; this
-- one states an invariant about a table it has nothing to do with. Together,
-- a database carrying a row that fails the check below would lose the centre
-- table too, for a reason that has nothing to do with it.
--
-- WHY NOT A PARTIAL UNIQUE INDEX or an index at all: there is no set to
-- constrain here, only a row, and the database is going to MySQL — which has no
-- partial indexes, while a CHECK over two columns of one row ports unchanged.

-- The check is stated before it is added, so that a database which somehow
-- carries such a row is told which grant and what to do about it. On its own,
-- the constraint would abort with „violates check constraint
-- seat_grants_live_names_a_programme”, which names no coordinator, no date and
-- no amount, and leaves whoever is watching a deployment with nothing to act
-- on.
--
-- No path in the portal can produce one: `acorda` refuses a grant with no
-- programme, `grantSeats` refuses a request that names none, and both guards
-- shipped in the same release as 0019. This is here because „no code path does
-- that” is a claim about the code as it is today, and the constraint is a
-- statement about the data for as long as it exists.
DO $$
DECLARE stray record;
BEGIN
  SELECT t.name AS teacher_name, g.seats, g.granted_at::date AS granted_on,
         count(*) OVER () AS how_many
    INTO stray
    FROM seat_grants g
    JOIN users t ON t.id = g.teacher_id
   WHERE g.programme_id IS NULL AND g.revoked_at IS NULL
   ORDER BY g.granted_at
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'seat_grants: % acordare(i) în vigoare nu numesc niciun program de studiu, prima fiind cea de % locuri către % din %. Un loc suplimentar se rezervă unui singur program, deci acestea nu pot fi ocupate de nimeni. Retrage-le din jurnalul locurilor de pe ecranul „Departament” și acordă-le din nou alegând programul, apoi reia migrarea.',
      stray.how_many, stray.seats, stray.teacher_name, stray.granted_on;
  END IF;
END $$;

ALTER TABLE seat_grants
  ADD CONSTRAINT seat_grants_live_names_a_programme
  CHECK (programme_id IS NOT NULL OR revoked_at IS NOT NULL);
