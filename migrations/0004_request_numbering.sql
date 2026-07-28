-- =============================================================================
-- Request numbers follow the academic year
-- =============================================================================
-- Numbers were built from `new Date().getFullYear()`, so a request submitted in
-- the 2025–2026 session was stamped CRR-2026-… next to a student number of
-- MK-2025-…. The seeded rows used the session's own start year, which meant one
-- session carried two numbering schemes — on a document that gets printed,
-- signed and filed at the registry.
--
-- The counter lives on the year and is incremented in the same transaction as
-- the insert, so numbers are sequential, unique without relying on a clock, and
-- leave no gap when a submission is rejected by the live-request index.
-- =============================================================================

ALTER TABLE academic_years ADD COLUMN request_counter integer NOT NULL DEFAULT 0;

UPDATE academic_years y
   SET request_counter = (SELECT count(*) FROM requests r WHERE r.academic_year_id = y.id);
