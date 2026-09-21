-- =============================================================================
-- A study programme states its four facts instead of implying them
-- =============================================================================
-- `study_programmes` was (academic_year_id, level, name, language), and `name`
-- meant two different things depending on `level`. At licență it was the FORM
-- OF STUDY — „Învățământ cu frecvență — RO”, „Învățământ la distanță — Buzău” —
-- with no specialisation written down anywhere. At master it was the
-- SPECIALISATION — „Marketing online” — with no form of study written down
-- anywhere.
--
-- The registry, which is the source of truth, has never done that. A SIMUR
-- export describes each student with four independent columns — cycle, form of
-- study, specialisation, language — plus `denumire`, the teaching centre, which
-- reads „MRK - București” on all 893 rows of the current file and exists to
-- distinguish Buzău. Commit cb5da23 shipped an importer that PROJECTED those
-- four onto the one `name`, through a hand-maintained table.
--
-- WHY THE PROJECTION HAD TO GO. It was invertible only because the faculty runs
-- exactly ONE licență specialisation. A second one could not be expressed at
-- all: two licență cohorts differing only by specialisation would have landed
-- on the same row, and a programme is not a label — it carries the seats a
-- coordinator may spend (0019), the catalogue a topic is offered to (0020) and
-- every filtered list and report in the portal. Merging them merges all of
-- that, silently, for two different groups of people.
--
-- So the four become columns, and the importer stops translating: it looks up
-- what the registry already states.
--
-- `name` STAYS, DEMOTED. It is read by a dozen queries — the coordinator
-- catalogue, the seats ledger, the topic list, the archive, the notification
-- subjects — and ripping it out is a larger, separate change. From here on it
-- is PRESENTATION: the display title, derived from the dimensions by
-- `programmeTitle` in `src/lib/programmes.mjs` and rewritten below so the two
-- agree from the first minute. The DIMENSIONS are the identity. Anything that
-- answers „which programme is this” must read them; anything that answers „what
-- does it say on the screen” may read `name`.
-- =============================================================================

-- --- the four facts ----------------------------------------------------------

-- `form_of_study` carries the ministry's codes and not Romanian words, because
-- the words are exactly what two registers spell differently: the portal seeded
-- „Învățământ fără frecvență” for the students the registry exports as
-- „FRECVENȚĂ REDUSĂ”, and no comparison of those two strings would ever have
-- connected them. A CHECK, because the list is closed and it is the ministry's:
-- a fourth form would be a change to the law, not to a faculty's paperwork.
--
-- `location` is deliberately NOT check-constrained, unlike the form. Teaching
-- centres are the faculty's own and it opens and closes them without telling
-- this portal; a constraint would turn „the faculty now also teaches at
-- Slobozia” into a failed migration, and 0023 already argued that case for
-- `FormaFinantare`.
ALTER TABLE study_programmes
  ADD COLUMN IF NOT EXISTS form_of_study  text,
  ADD COLUMN IF NOT EXISTS specialisation text,
  ADD COLUMN IF NOT EXISTS location       text;

ALTER TABLE study_programmes
  DROP CONSTRAINT IF EXISTS study_programmes_form_of_study_check;
ALTER TABLE study_programmes
  ADD CONSTRAINT study_programmes_form_of_study_check
    CHECK (form_of_study IN ('if', 'ifr', 'id'));

-- --- the thirteen rows that exist today --------------------------------------

-- The eleven seeded by 0020 and the two added by 0023, read out of their names
-- one by one. Written out rather than parsed: „Învățământ fără frecvență” is
-- `ifr` and nothing in those three words says so, and a rule clever enough to
-- guess it would also guess wrong about the next name somebody types by hand.
--
-- „Managementul relațiilor cu clienții” is two rows — Romanian and English —
-- and both are matched here, because the language is already a column of its
-- own and does not need to be repeated in this table.
UPDATE study_programmes p
   SET form_of_study  = v.form,
       specialisation = v.specialisation,
       location       = v.location
  FROM (VALUES
    ('bachelor', 'Învățământ cu frecvență — RO',        'if',  'Marketing', 'București'),
    ('bachelor', 'Învățământ cu frecvență — EN',        'if',  'Marketing', 'București'),
    ('bachelor', 'Învățământ fără frecvență',           'ifr', 'Marketing', 'București'),
    ('bachelor', 'Învățământ la distanță — București',  'id',  'Marketing', 'București'),
    ('bachelor', 'Învățământ la distanță — Buzău',      'id',  'Marketing', 'Buzău'),
    ('master',   'Cercetări de marketing',              'if',  'Cercetări de marketing',              'București'),
    ('master',   'Marketing și comunicare în afaceri',  'if',  'Marketing și comunicare în afaceri',  'București'),
    ('master',   'Marketing online',                    'if',  'Marketing online',                    'București'),
    ('master',   'Relații publice în marketing',        'if',  'Relații publice în marketing',        'București'),
    ('master',   'Marketing strategic',                 'if',  'Marketing strategic',                 'București'),
    ('master',   'Managementul relațiilor cu clienții',  'if', 'Managementul relațiilor cu clienții', 'București'),
    ('master',   'Managementul marketingului',          'if',  'Managementul marketingului',          'București')
  ) AS v(level, name, form, specialisation, location)
 WHERE p.level = v.level AND p.name = v.name;

-- --- everything else ---------------------------------------------------------

-- A database can hold programmes the portal never seeded: the five demo names
-- that predate 0020 („Marketing” at licență, „Marketing digital” at master) and
-- anything a director has since typed into „An universitar”. They have to get
-- values too — the columns are about to become NOT NULL, and a programme with
-- no form of study would be one the importer can never match and the director
-- can never see the shape of.
--
-- At master the name IS the specialisation: 0020, 0023, the importer and the
-- „Program nou” form have all meant it that way since the beginning, so the
-- rule is not a guess.
--
-- At licență the name may be either, so the form is read out of it where the
-- words are there („la distanță”, „frecvență redusă”) and the whole name
-- becomes the specialisation otherwise. That last case is the only guess in
-- this migration, it is visible to the director on the „An universitar” screen,
-- and it is correctable there. `if` and „București” are what is left when the
-- name says nothing — an unmarked row, not a silent default: on the way IN,
-- from the registry, nothing is ever assumed.
UPDATE study_programmes
   SET form_of_study = COALESCE(
         form_of_study,
         CASE
           WHEN name ILIKE '%distanț%' OR name ILIKE '%distant%' THEN 'id'
           WHEN name ILIKE '%redus%' OR name ILIKE '%fără frecvenț%' THEN 'ifr'
           ELSE 'if'
         END),
       location = COALESCE(
         location,
         CASE WHEN name ILIKE '%buzău%' OR name ILIKE '%buzau%' THEN 'Buzău'
              ELSE 'București' END),
       specialisation = COALESCE(specialisation, name)
 WHERE form_of_study IS NULL OR location IS NULL OR specialisation IS NULL;

-- --- the old uniqueness, and why it goes -------------------------------------

-- 0002 declared UNIQUE (academic_year_id, level, name, language). It is now a
-- constraint on a PRESENTATION column: `name` is computed from the identity a
-- few lines below, so the old key can only ever fire as a consequence of the
-- new one — a second, weaker statement of the same rule, and the one a reader
-- would reach for first because it is the older and more familiar of the two.
--
-- It also actively gets in the way twice. The rename below rewrites `name` on
-- every row, and a non-deferrable UNIQUE is checked row by row: a perfectly
-- legal final state can fail on an intermediate one, depending on the order the
-- planner happens to update in. And three writers infer `ON CONFLICT
-- (academic_year_id, level, name, language)` from it — the seed, „An
-- universitar” and 0020/0023 — which is exactly the wrong key from now on: a
-- re-run must find a programme by what it IS, not by what it is CALLED, or
-- renaming a label would silently create a second row for the same cohort.
--
-- Looked up rather than dropped by name: the name is Postgres's own default and
-- a database where somebody renamed the constraint by hand would keep it, and
-- then fail on the rewrite for a reason nothing here explains.
DO $$
DECLARE which text;
BEGIN
  SELECT c.conname INTO which
    FROM pg_constraint c
   WHERE c.conrelid = 'study_programmes'::regclass
     AND c.contype = 'u'
     AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
            FROM unnest(c.conkey) AS k(attnum)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum)
         = ARRAY['academic_year_id', 'language', 'level', 'name'];

  IF which IS NOT NULL THEN
    EXECUTE format('ALTER TABLE study_programmes DROP CONSTRAINT %I', which);
  END IF;
END $$;

-- --- two rows that are now one programme -------------------------------------

-- The new identity can discover that two rows describe the same cohort. The one
-- case that really occurs: a database that still carries the pre-0020 demo row
-- „Marketing” at licență. Under the old model it was a different `name` from
-- „Învățământ cu frecvență — RO”; under the new one both are Marketing, cu
-- frecvență, in București, and one of them has to go.
--
-- A row that is already retired and that NOTHING points at — no student, no
-- topic, no request, no granted or requested seat — is deleted. That is
-- provably lossless: it is a name in a list nobody stands in, which is exactly
-- what 0020 left behind when it retired the demo programmes it could retire.
-- The `(q.is_active OR q.id < p.id)` is what keeps one of the pair: without it
-- a duplicate of two retired rows would delete both and the programme would
-- vanish.
--
-- Anything still doubled carries somebody's arithmetic, and this migration will
-- not decide whose. It stops, names both rows, and says what to do — a unique
-- index failing on its own would say only „Key (…) is duplicated”, which names
-- neither programme and nobody can act on.
DO $$
DECLARE doubled record;
BEGIN
  DELETE FROM study_programmes p
   WHERE p.is_active = false
     AND EXISTS (
       SELECT 1 FROM study_programmes q
        WHERE q.id <> p.id
          AND q.academic_year_id = p.academic_year_id
          AND q.level = p.level
          AND q.form_of_study = p.form_of_study
          AND q.specialisation = p.specialisation
          AND q.language = p.language
          AND q.location = p.location
          AND (q.is_active OR q.id < p.id))
     AND NOT EXISTS (SELECT 1 FROM users         u WHERE u.programme_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM topics        t WHERE t.programme_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM requests      r WHERE r.programme_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM seat_grants   g WHERE g.programme_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM seat_requests s WHERE s.programme_id = p.id);

  SELECT p.name AS first_name, q.name AS second_name, y.label AS year_label
    INTO doubled
    FROM study_programmes p
    JOIN study_programmes q
      ON q.id <> p.id
     AND q.academic_year_id = p.academic_year_id
     AND q.level = p.level
     AND q.form_of_study = p.form_of_study
     AND q.specialisation = p.specialisation
     AND q.language = p.language
     AND q.location = p.location
    JOIN academic_years y ON y.id = p.academic_year_id
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'study_programmes: "%" and "%" are the same programme in % under the new identity (level, form of study, specialisation, language, location), and both are in use. Move the students, topics and seats off one of them on the "An universitar" screen, retire it, then run the migration again.',
      doubled.first_name, doubled.second_name, doubled.year_label;
  END IF;
END $$;

-- --- the label, computed from the facts --------------------------------------

-- `name` becomes the display title, and stops being anybody's input. The rule
-- is `programmeTitle` in `src/lib/programmes.mjs`, written out once in SQL
-- here: specialisation, then the form of study — always, including the ordinary
-- one — then the centre when it is not the main one. A test pins the thirteen
-- titles this produces against the ones the module produces, because the two
-- spellings parting company is the failure that creates a duplicate programme
-- on the next seed.
--
-- „Învățământ cu frecvență — RO” therefore becomes „Marketing · învățământ cu
-- frecvență”, which is what the faculty actually runs and what the diploma
-- says. The form is written out at master too, where it is „cu frecvență” on
-- every row today: the day a master's programme opens in frecvență redusă,
-- nothing on any screen has to change to tell the two apart.
UPDATE study_programmes
   SET name = specialisation
              || ' · '
              || CASE form_of_study
                   WHEN 'if'  THEN 'învățământ cu frecvență'
                   WHEN 'ifr' THEN 'învățământ cu frecvență redusă'
                   WHEN 'id'  THEN 'învățământ la distanță'
                 END
              || CASE WHEN location <> 'București' THEN ' · ' || location ELSE '' END
              -- The language, by the same rule as the centre: written only when
              -- it is not the ordinary one. Without it the two licență „cu
              -- frecvență” rows, and the two „Managementul relațiilor cu
              -- clienții” ones, carry the same `name` — and `name` is what a
              -- dozen queries print on its own, including the audit subject.
              || CASE WHEN language <> 'ro'
                        THEN ' · ' || CASE language
                                        WHEN 'en' THEN 'Engleză'
                                        WHEN 'fr' THEN 'Franceză'
                                        WHEN 'de' THEN 'Germană'
                                        ELSE language
                                      END
                        ELSE '' END;

-- The copy on the student follows the rename.
--
-- `users.specialization` is a denormalised copy of the programme's display
-- title — `/api/studenti` writes it on every move and six screens group and
-- filter on it without a join. Left alone it would still read „Învățământ cu
-- frecvență — RO” while the programme reads „Marketing · învățământ cu
-- frecvență”, and the faculty list would show one cohort as two groups.
UPDATE users u
   SET specialization = p.name
  FROM study_programmes p
 WHERE p.id = u.programme_id
   AND u.specialization IS DISTINCT FROM p.name;

-- --- the facts are not optional ----------------------------------------------

-- Safe because the two backfills above cover every row: `level` and `name` are
-- already NOT NULL, so the second one has a value to work from for anything the
-- first did not name.
ALTER TABLE study_programmes
  ALTER COLUMN form_of_study  SET NOT NULL,
  ALTER COLUMN specialisation SET NOT NULL,
  ALTER COLUMN location       SET NOT NULL;

-- --- the real identity -------------------------------------------------------

-- A PLAIN unique index, not a partial one. The database is going to be ported
-- to MySQL, which has no partial indexes at all; five partial unique indexes
-- are already a known cost of that port, and this must not become the sixth.
-- There is nothing to make it partial about in any case — every row of every
-- year has all five values, which is what the NOT NULLs above are for.
CREATE UNIQUE INDEX idx_programmes_identity
  ON study_programmes (academic_year_id, level, form_of_study, specialisation,
                       language, location);

-- „Which specialisations does the faculty run this year”, which is a filter on
-- the faculty list now and was not expressible at all before today.
CREATE INDEX idx_programmes_specialisation
  ON study_programmes (academic_year_id, specialisation);
