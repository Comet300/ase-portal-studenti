-- A cancelled consultation is an event like any other in the pair's thread.
--
-- Cancelling told nobody anything: an UPDATE on the booking and that was all,
-- even though the confirmation dialog promised the student that „coordonatorul
-- vede anularea”. Now an email goes out, a cancellation invitation in the
-- calendar and an event in the thread — and its type has to exist in the
-- constraint, otherwise `postEvent` rejects it in silence, because it swallows
-- any error so as not to break the action already carried out.

ALTER TABLE messages DROP CONSTRAINT messages_event_type_check;

ALTER TABLE messages ADD CONSTRAINT messages_event_type_check
  CHECK (event_type IN (
    'request_approved', 'request_rejected', 'request_expired', 'request_withdrawn',
    'invitation_sent', 'invitation_accepted', 'invitation_declined',
    'consultation_scheduled', 'consultation_cancelled', 'seats_granted'
  ));
