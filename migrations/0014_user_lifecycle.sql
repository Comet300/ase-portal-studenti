-- Oamenii intră și ies din portal.
--
-- Până acum nu făceau nici una, nici alta: singurul `INSERT INTO users` din tot
-- proiectul era în `scripts/seed.mjs`, deci o promoție se popula rulând un script
-- pe producție, iar un absolvent sau un profesor pensionat păstra un cont activ
-- la nesfârșit. Adresa de email nu se putea nici ea corecta, iar autentificarea
-- este exclusiv prin link trimis la ea — o literă greșită însemna un om închis
-- pe dinafară definitiv.
--
-- Dezactivare, nu ștergere: cererile, deciziile și lucrările lui rămân în registrul
-- academic, care are rostul de a putea fi citit peste ani. Se închide doar
-- accesul, iar `deactivated_at` spune de când.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_active      boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  -- Cine l-a adus în portal. NULL pentru rândurile din seed și pentru migrare.
  ADD COLUMN IF NOT EXISTS created_by     uuid REFERENCES users(id) ON DELETE SET NULL;

-- Căutarea după email este acum și calea prin care se verifică duplicatele la
-- adăugare, deci merită să fie ieftină și insensibilă la litere mari.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));

-- Sesiunile unui om dezactivat nu au voie să supraviețuiască dezactivării.
-- Ştergerea lor este parte din operațiune, nu o curățenie ulterioară.
