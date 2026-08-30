-- Who read the cohort's personal data.
--
-- The portal keeps names, student numbers, institutional addresses, thesis
-- titles, statements of motivation written by hand, private conversations and
-- uploaded documents, for a whole cohort. Any member of the teaching staff can
-- download the department's complete table — `doar_ale_mele` is an option, not
-- a restriction — and nothing ever recorded that they had done so.
--
-- For a public institution under the GDPR, an export that leaves no trace is
-- exactly the kind of gap that closes a portal down. Exports and file access are
-- recorded: they are the two paths by which the data leaves the portal.
--
-- This is not an application log: it holds no content, only who, what kind of
-- access, what they touched and when. It is kept for a year — enough for an
-- inspection, not enough for surveillance.

CREATE TABLE access_log (
  id         bigserial   PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action     text        NOT NULL,
  -- What was touched: an id, a route, a filter. Free text, because the shapes
  -- differ, but never the content itself.
  subject    text,
  -- How many records they saw: the difference between opening one file and
  -- downloading the entire cohort.
  row_count  integer,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_access_log_user ON access_log (user_id, created_at DESC);
CREATE INDEX idx_access_log_when ON access_log (created_at DESC);
