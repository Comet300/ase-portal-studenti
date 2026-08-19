-- What has already been sent, so that it is not sent twice.
--
-- The portal announced deadlines only after they had passed: the expired
-- request, the expired invitation. A warning beforehand — „mai ai două zile” —
-- is the only one that changes anything, but it has a problem the after-the-fact
-- announcement does not: it can be re-sent. The sweep runs on every request
-- (rate-limited), and now from a scheduler as well; without a trace of what has
-- been sent, a student would get the same reminder ten times a day.
--
-- The key includes the day: a reminder for „T-3” and one for „T-0” are two
-- different notifications about the same deadline, and a year later the same
-- combination can legitimately come round again.

CREATE TABLE notifications_sent (
  user_id  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind     text        NOT NULL,
  ref_id   uuid        NOT NULL,
  sent_on  date        NOT NULL DEFAULT current_date,
  sent_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, ref_id, sent_on)
);

-- The periodic clean-up goes by date, so the index is on it.
CREATE INDEX idx_notifications_sent_on ON notifications_sent (sent_on);
