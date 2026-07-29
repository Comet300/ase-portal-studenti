-- =============================================================================
-- The session a thesis is defended in
-- =============================================================================
-- `academic_year_id` on a request answers "when did this coordination start" —
-- it is what seats, the topic catalogue and the triage queue are scoped by, and
-- it is correct for all of them.
--
-- The archive asks a different question: in which session was this thesis
-- defended. A student may choose a coordinator in the second year of a bachelor
-- and defend at the end of the third, so the two answers are one year apart and
-- one column cannot serve both. Filed under the starting year, that thesis would
-- be missing from the archive of the session it actually belongs to.
--
-- Null means "the same session it started in", which is the common case and
-- keeps every existing row correct without a backfill.
-- =============================================================================

ALTER TABLE requests
  ADD COLUMN graduation_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL;

CREATE INDEX idx_requests_graduation
  ON requests (graduation_year_id) WHERE graduation_year_id IS NOT NULL;
