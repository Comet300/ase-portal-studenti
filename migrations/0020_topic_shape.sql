-- =============================================================================
-- A topic says what it is about and for whom, and stops counting seats
-- =============================================================================
-- Three columns of `topics` were written for a portal that does not exist any
-- more, and the screen had been papering over all three with labels.
--
-- `methods` was shown as „Metode” and coordinators wrote a methodology in it —
-- „anchetă pe bază de chestionar, eșantion de 200”. The name stays about the
-- text that is actually there: `methodology`.
--
-- `prerequisites` was shown as „Prerechizite” and was almost never used for a
-- prerequisite. What a student looks for first is the field the topic belongs
-- to — consumer behaviour, retail, digital — so the column is renamed to what
-- the faculty means by it, `domain`, and the screen asks for a domain. This is
-- a change of meaning, not a relabelling, which is why it is a rename and not
-- a comment: a column called `prerequisites` holding a domain is the drift
-- every other migration here argues against.
--
-- `language` was asked for as „Limba lucrării”, with a hint claiming the topic
-- would only be shown to students of that language — which nothing in the query
-- layer ever did. The real question behind it is the study programme, and the
-- portal already has those, per year and per level, in `study_programmes`. The
-- topic now points at one, and the language is derived from it instead of being
-- a second, independent answer that could contradict the first.
--
-- `seats` is deleted outright. Capacity belongs to the coordinator, not to the
-- topic: `seat_allocations` and `seat_grants` decide how many students a person
-- may take at a level and in a programme, and the gate in `/api/cereri/depune`
-- has enforced only that for two releases. „2 locuri” on a topic was a second
-- number, on the same screen, that bound nothing — and it read as a promise.

-- --- what the text is ------------------------------------------------------
ALTER TABLE topics RENAME COLUMN methods       TO methodology;
ALTER TABLE topics RENAME COLUMN prerequisites TO domain;

-- --- whom it is for --------------------------------------------------------
ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS programme_id uuid REFERENCES study_programmes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_topics_programme ON topics (programme_id);

-- --- the seats that were never counted -------------------------------------
ALTER TABLE topics DROP COLUMN IF EXISTS seats;

-- =============================================================================
-- The faculty's actual study programmes
-- =============================================================================
-- Until now the list came from `scripts/seed.mjs` — five made-up names, good
-- enough for a demo and wrong on every screen that shows them to a person. The
-- real ones, for the year under way:
--
-- At licență the faculty runs one programme, Marketing, in five forms of study,
-- and that is the distinction a topic and a seat are actually about: a student
-- at Buzău and one in the Romanian day programme are not interchangeable to a
-- coordinator. At master the five are separate programmes.
--
-- `ON CONFLICT DO NOTHING` on the existing unique key `(academic_year_id,
-- level, name, language)`: a re-run adds nothing, and a name already entered by
-- the director by hand is left exactly as they wrote it.
INSERT INTO study_programmes (academic_year_id, level, name, language, duration_years)
SELECT y.id, p.level, p.name, p.language, p.years
  FROM academic_years y
  CROSS JOIN (VALUES
    ('bachelor', 'Învățământ cu frecvență — RO',        'ro', 3),
    ('bachelor', 'Învățământ cu frecvență — EN',        'en', 3),
    ('bachelor', 'Învățământ fără frecvență',           'ro', 3),
    ('bachelor', 'Învățământ la distanță — București',  'ro', 3),
    ('bachelor', 'Învățământ la distanță — Buzău',      'ro', 3),
    ('master',   'Cercetări de marketing',              'ro', 2),
    ('master',   'Marketing și comunicare în afaceri',  'ro', 2),
    ('master',   'Marketing online',                    'ro', 2),
    ('master',   'Relații publice în marketing',        'ro', 2),
    ('master',   'Marketing strategic',                 'ro', 2),
    ('master',   'Managementul relațiilor cu clienții', 'ro', 2)
  ) AS p(level, name, language, years)
 WHERE y.is_current
ON CONFLICT (academic_year_id, level, name, language) DO NOTHING;

-- The demo names are retired, but only the ones nobody stands in.
--
-- Three of the five seeded programmes are not the faculty's: „Marketing” as a
-- licență programme (the licență programme is the form of study, above) and
-- „Marketing digital” at master. The other two — „Marketing strategic” and
-- „Cercetări de marketing” — are real, and the INSERT above matched them
-- exactly, so they carry on with their students and their earmarked seats.
--
-- A programme somebody is enrolled in, or that has seats reserved for it,
-- carries live arithmetic: retiring it would take those seats out of a
-- coordinator's pot without anyone asking. Those rows stay, and the director
-- retires them after moving the people. The rest simply stop being offered.
UPDATE study_programmes p
   SET is_active = false
  FROM academic_years y
 WHERE p.academic_year_id = y.id
   AND y.is_current
   AND p.is_active
   AND (p.level, p.name) IN (('bachelor', 'Marketing'), ('master', 'Marketing digital'))
   AND NOT EXISTS (SELECT 1 FROM users u WHERE u.programme_id = p.id)
   AND NOT EXISTS (SELECT 1 FROM seat_grants g WHERE g.programme_id = p.id);

-- --- the topics that already exist -----------------------------------------
-- Every topic gets the programme that matches what it already said: its level,
-- and the language it was written in. Where the year has exactly one such
-- programme the answer is certain; where it has several — licență in Romanian
-- now has four forms of study — there is nothing in the row to choose between
-- them, so it is left NULL and the coordinator picks it the next time they open
-- the topic. A guess here would be a fact on a student's screen.
UPDATE topics t
   SET programme_id = p.id
  FROM study_programmes p
 WHERE t.programme_id IS NULL
   AND p.academic_year_id = t.academic_year_id
   AND p.level = t.level
   AND p.language = t.language
   AND p.is_active
   AND (
     SELECT count(*) FROM study_programmes q
      WHERE q.academic_year_id = t.academic_year_id
        AND q.level = t.level
        AND q.language = t.language
        AND q.is_active
   ) = 1;
