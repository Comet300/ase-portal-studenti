-- =============================================================================
-- A teaching centre is a row somebody created, not a string somebody typed
-- =============================================================================
-- Migration 0024 made `location` a first-class NOT NULL column and part of what
-- identifies a programme: the unique index is (academic_year_id, level,
-- form_of_study, specialisation, language, location). It left the column
-- unconstrained, on purpose and with a reason that still holds — forms of study
-- are the ministry's closed list, but teaching centres are the faculty's, and it
-- opens one without telling this portal. A CHECK would turn „the faculty now
-- also teaches at Slobozia” into a failed migration.
--
-- What it costs, though, is that two spellings of one city are two programmes.
-- „Buzau”, „buzău” and „Buzău ” each satisfy the index separately, so a director
-- who mistypes the centre on the „Program nou” form opens a second row for a
-- cohort that already exists — and that row carries its own seats (0019), its
-- own catalogue entry (0020), its own line in every report and its own half of
-- the students. Nothing anywhere says the two are the same people. The „An
-- universitar” form offers a `datalist` of the centres already in use, which
-- makes the typo less likely and prevents exactly nothing: a `datalist` is a
-- suggestion, the field stays free text, and one keystroke past the suggestion
-- is a new centre.
--
-- THE ANSWER IS A REFERENCE TABLE, NOT A CHECK. A centre still does not need a
-- law to exist — it needs a row. Adding one stays a thing the director can do at
-- any time, from the same screen, in one deliberate act; what stops being
-- possible is creating one by accident while typing something else.
--
-- WHY IT IS GLOBAL AND NOT SCOPED TO AN ACADEMIC YEAR. A teaching centre is a
-- property of the faculty — the building exists whether or not this year's
-- programmes use it — and `src/lib/years.ts` settles the question. `openYear`
-- copies every programme forward carrying `location` verbatim, and re-points the
-- students by the five facts including that one. Year-scoped, the rollover would
-- have to create a matching centre row for the new year first or the copy would
-- fail on a foreign key, and the one thing a rollover must not do is stop
-- halfway. Global, the copy is untouched and this file adds nothing to it.
-- =============================================================================

-- The name IS the key, and that is what makes the rename below work: a
-- programme stores the centre it is taught at, not a number that stands for it,
-- so the two dozen queries that read `location` keep reading a city.
--
-- `varchar(120)` rather than `text` for the port: MySQL cannot make a TEXT
-- column a primary key without a prefix length, and a key with a prefix length
-- cannot be the target of a foreign key at all. 120 is past the longest Romanian
-- place name by a wide margin. `study_programmes.location` is widened to the
-- same type below — MySQL requires the two sides of a foreign key to match, and
-- Postgres compares varchar and text with the same operator either way.
CREATE TABLE teaching_locations (
  name       varchar(120) PRIMARY KEY,
  -- Who opened it, for the same reason every other decision in this portal
  -- leaves a name: a centre nobody remembers agreeing to is one nobody dares
  -- delete. ON DELETE SET NULL, because closing a director's account must not
  -- take a teaching centre — and its programmes — down with it.
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The centres the faculty is already teaching at, read out of the programmes
-- themselves. There is no other source: 0020 seeded eleven programmes in
-- București, 0023 added the two that made Buzău necessary, and a director may
-- have typed a third since.
--
-- HISTORY IS NOT REWRITTEN HERE. If a database already holds „Buzau” beside
-- „Buzău”, both arrive in this table and both stay. They are two rows of
-- `study_programmes` carrying two sets of somebody's seats, and merging them is
-- a move of students, topics and grants that only the director can authorise —
-- the same judgement 0024 made when it refused to merge two programmes that were
-- both in use. What changes today is that they are now VISIBLE, as two lines in
-- one short list on the „An universitar” screen, instead of being two invisible
-- values inside thirteen programme names; and that no third one can appear by
-- accident. `normalizeLocation` in `src/lib/programmes.mjs` guards the door from
-- here on.
INSERT INTO teaching_locations (name)
SELECT DISTINCT location FROM study_programmes
ON CONFLICT DO NOTHING;

ALTER TABLE study_programmes
  ALTER COLUMN location TYPE varchar(120);

-- ON UPDATE CASCADE, because the name is the key and a rename is therefore an
-- update of it. Without the cascade the foreign key would simply refuse the
-- rename — a centre could never be corrected, only abandoned and re-created,
-- which is how the duplicates this migration exists to stop get made. There is
-- no SET NULL alternative to consider: `location` is NOT NULL since 0024.
--
-- ON DELETE RESTRICT, because a centre that programmes still name is not a
-- centre anybody may remove. NO ACTION would behave identically here, and
-- RESTRICT is chosen for being the one of the two that says so out loud and
-- cannot be deferred to the end of a transaction. A centre with no programmes
-- left deletes cleanly, which is the case worth allowing.
--
-- No index on the referencing column: `study_programmes` is thirteen rows and
-- one per programme per year thereafter, so the sequential scan a delete or a
-- rename costs is smaller than the index would be.
ALTER TABLE study_programmes
  ADD CONSTRAINT study_programmes_location_fkey
  FOREIGN KEY (location) REFERENCES teaching_locations (name)
  ON UPDATE CASCADE ON DELETE RESTRICT;
