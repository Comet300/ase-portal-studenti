-- What exactly happened, not just which conversation it happened in.
--
-- Every notification led to the conversation thread, the only thing an event
-- knew about itself. „Locuri alocate” opened a chat, „Cerere aprobată” did the
-- same, and the decision the reader wanted to see was on another screen, which
-- they had to go and find on their own.
--
-- The subject is kept, not the address: the destination depends on the reader's
-- role (the same consultation slot is /consultatii for the student and
-- /profesor/consultatii for the coordinator), and a path written at the moment
-- of the decision would have aged along with the routes.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS subject_kind text
    CHECK (subject_kind IN ('request', 'invitation', 'slot')),
  ADD COLUMN IF NOT EXISTS subject_id uuid;

-- No foreign key: the subject can be deleted (a withdrawn request, a cancelled
-- slot) without the notification that announces it disappearing from the
-- history. The screen checks on read whether it still exists.
