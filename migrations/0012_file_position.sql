-- Ordinea atașamentelor unui mesaj.
--
-- De când un mesaj poate purta mai multe fișiere, ele se scriu în aceeași
-- tranzacție — iar `now()` este fix pe toată durata ei, deci toate trei au exact
-- același `created_at`. Sortarea cădea pe `id`, care este un uuid aleatoriu:
-- „capitolul 1, chestionarul, datele” se afișa în orice ordine, alta la fiecare
-- mesaj.
--
-- Ordinea în care cineva își atașează fișierele este o informație — capitolul
-- întâi, anexele după — deci se păstrează, nu se reconstruiește din ceas.
ALTER TABLE files ADD COLUMN IF NOT EXISTS position smallint NOT NULL DEFAULT 0;

-- Rândurile existente au cel mult un fișier pe mesaj, deci zero este corect
-- pentru toate.
