-- =============================================================================
-- Withdrawing a request
-- =============================================================================
-- Three screens told a student to withdraw a pending request and no code could
-- do it. Until the seven-day deadline expired they could not switch coordinator
-- and could not accept an invitation, because the partial unique index counts a
-- pending request as live.
--
-- A withdrawn request is kept rather than deleted: the coordinator saw it, may
-- have started reading it, and the archive should show that it happened. The
-- new status falls outside `idx_requests_one_active`, so the student is free
-- again immediately.
-- =============================================================================

ALTER TABLE requests DROP CONSTRAINT requests_status_check;
ALTER TABLE requests ADD CONSTRAINT requests_status_check
  CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'expired', 'withdrawn'));

-- The thread records it too, so the coordinator sees why the request vanished
-- from their queue.
ALTER TABLE messages DROP CONSTRAINT messages_event_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_event_type_check
  CHECK (event_type IN (
    'request_approved', 'request_rejected', 'request_expired', 'request_withdrawn',
    'invitation_sent', 'invitation_accepted', 'invitation_declined',
    'consultation_scheduled', 'seats_granted'
  ));
