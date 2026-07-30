-- Susținerea, ca fapt distinct de aprobare.
--
-- Arhiva prezenta `requests.decided_at` drept dată a susținerii: o lucrare
-- aprobată în martie și susținută în iulie apărea în arhivă cu martie. Sunt două
-- evenimente diferite la câteva luni distanță, iar arhiva unei facultăți este
-- exact locul în care diferența contează.
--
-- Terminarea lucrării nu avea nici stare: o coordonare rămânea „aprobată” pentru
-- totdeauna, deci un student care își luase licența în urmă cu doi ani apărea în
-- continuare printre cei coordonați activ.

ALTER TABLE requests
  ADD COLUMN defended_on date,
  ADD COLUMN grade       numeric(4, 2);

-- Doar lucrările susținute au dată; indexul servește listele de arhivă.
CREATE INDEX idx_requests_defended
  ON requests (defended_on) WHERE defended_on IS NOT NULL;

-- Starea „susținută” intră în vocabularul existent, ca badge-urile și filtrele
-- să nu aibă nevoie de un caz special.
ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_status_check;
ALTER TABLE requests ADD CONSTRAINT requests_status_check
  CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'expired', 'withdrawn', 'defended'));
