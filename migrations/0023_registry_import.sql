-- =============================================================================
-- What the registry's own export says and the portal had nowhere to put
-- =============================================================================
-- The faculty's list arrives as a SIMUR export: 893 rows, 25 columns, one per
-- student in a final year. Two of its facts had no column here, and both were
-- being thrown away at the door.
--
-- `AnStudiu` is not always a digit. Twenty-seven students are written „3
-- Suplimentar” — in the third year, for the second time. Reading that as „3”
-- and dropping the rest loses the one thing a coordinator needs to know before
-- agreeing to supervise a thesis due in June; refusing the row instead, which
-- is what happened until now, leaves twenty-seven people unable to sign in at
-- all. The year goes in `study_year` and the qualifier in `study_year_note`,
-- as text: the registry's vocabulary is the registry's, and a portal that
-- turned it into a boolean would be inventing a fact it does not own.
--
-- `FormaFinantare` says who pays — „Taxa”, „Buget RO”, „Bursier_RP”, twelve
-- values in this one file. It decides which forms a student signs and which
-- deadlines apply to them, and the secretariat asks for it by name. Text, and
-- not a check constraint: the list is the ministry's and changes without this
-- portal being told, and a constraint would turn next year's new code into a
-- failed import in the middle of a transaction.
--
-- Nothing here stores the CNP, the identity card, the date of birth, the sex,
-- the telephones or the domicile, all of which the export also carries. They
-- are read past deliberately — see `src/lib/import/students.ts`.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS study_year_note text,
  ADD COLUMN IF NOT EXISTS funding         text;

-- =============================================================================
-- Two programmes the faculty runs and the portal did not have
-- =============================================================================
-- Migration 0020 seeded the study programmes from what the faculty said it ran.
-- The export shows two more, with students already in them:
--
--   * „Managementul relațiilor cu clienții” in ENGLISH — 30 students. 0020
--     seeded only the Romanian one. A programme is unique on (year, level,
--     name, language), so this is a second row and not an edit: the two
--     cohorts are taught separately and are not interchangeable to anybody.
--   * „Managementul marketingului” — one student. One student is still a
--     student who would otherwise be imported onto no programme, and therefore
--     be absent from every list, catalogue and report that filters by one.
--
-- No column for the form of study. At licență the programme already IS the
-- form — 0020 made that decision — and every master row in the export is „CU
-- FRECVENȚĂ”, so a column would be a constant with a name.
--
-- `ON CONFLICT DO NOTHING` on the existing unique key, as in 0020: a re-run
-- adds nothing, and a name the director has already entered by hand is left
-- exactly as they wrote it.
INSERT INTO study_programmes (academic_year_id, level, name, language, duration_years)
SELECT y.id, p.level, p.name, p.language, p.years
  FROM academic_years y
  CROSS JOIN (VALUES
    ('master', 'Managementul relațiilor cu clienții', 'en', 2),
    ('master', 'Managementul marketingului',          'ro', 2)
  ) AS p(level, name, language, years)
 WHERE y.is_current
ON CONFLICT (academic_year_id, level, name, language) DO NOTHING;
