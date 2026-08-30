-- The order of a message's attachments.
--
-- Ever since a message can carry several files, they are written in the same
-- transaction — and `now()` is fixed for the whole of it, so all three get
-- exactly the same `created_at`. Sorting fell back on `id`, which is a random
-- uuid: „capitolul 1, chestionarul, datele” came out in any order, a different
-- one for every message.
--
-- The order in which someone attaches their files is information — the chapter
-- first, the annexes after — so it is kept, not reconstructed from the clock.
ALTER TABLE files ADD COLUMN IF NOT EXISTS position smallint NOT NULL DEFAULT 0;

-- Existing rows carry at most one file per message, so zero is correct for
-- every one of them.
