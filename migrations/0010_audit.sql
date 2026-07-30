-- Cine a citit datele personale ale cohortei.
--
-- Portalul păstrează nume, numere matricole, adrese instituționale, titluri de
-- lucrări, motivații scrise de mână, conversații private și documente încărcate,
-- pentru o promoție întreagă. Orice cadru didactic poate descărca tabelul
-- complet al departamentului — `doar_ale_mele` este o opțiune, nu o restricție —
-- și nimic nu înregistra vreodată că a făcut-o.
--
-- Pentru o instituție publică sub GDPR, un export fără urmă este exact felul de
-- lipsă care închide un portal. Se înregistrează exporturile și accesul la
-- fișiere: sunt cele două căi prin care datele pleacă din portal.
--
-- Nu este un jurnal de aplicație: nu ține conținut, doar cine, ce fel de acces,
-- ce a atins și când. Se păstrează un an — suficient pentru o verificare, nu
-- pentru o supraveghere.

CREATE TABLE access_log (
  id         bigserial   PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action     text        NOT NULL,
  -- Ce a fost atins: un id, o rută, un filtru. Text liber, pentru că formele
  -- diferă, dar niciodată conținutul însuși.
  subject    text,
  -- Câte înregistrări a văzut: diferența dintre a deschide un fișier și a
  -- descărca întreaga promoție.
  row_count  integer,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_access_log_user ON access_log (user_id, created_at DESC);
CREATE INDEX idx_access_log_when ON access_log (created_at DESC);
