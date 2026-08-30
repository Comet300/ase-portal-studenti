-- The defence, as a fact distinct from the approval.
--
-- The archive presented `requests.decided_at` as the date of the defence: a
-- thesis approved in March and defended in July appeared in the archive with
-- March. They are two different events a few months apart, and a faculty's
-- archive is exactly the place where the difference matters.
--
-- Finishing the thesis had no state either: a supervision stayed „aprobată”
-- forever, so a student who had taken their degree two years ago still showed
-- up among those actively supervised.

ALTER TABLE requests
  ADD COLUMN defended_on date,
  ADD COLUMN grade       numeric(4, 2);

-- Only defended theses have a date; the index serves the archive listings.
CREATE INDEX idx_requests_defended
  ON requests (defended_on) WHERE defended_on IS NOT NULL;

-- The „susținută” state joins the existing vocabulary, so that badges and
-- filters do not need a special case.
ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_status_check;
ALTER TABLE requests ADD CONSTRAINT requests_status_check
  CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'expired', 'withdrawn', 'defended'));
