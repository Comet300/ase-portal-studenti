-- Ce anume s-a întâmplat, nu doar în care conversație.
--
-- Fiecare notificare ducea în firul de discuție, singurul lucru pe care un
-- eveniment îl știa despre sine. „Locuri alocate” deschidea un chat, „Cerere
-- aprobată” la fel, iar decizia pe care cititorul voia să o vadă era pe alt
-- ecran, pe care trebuia să îl caute singur.
--
-- Se păstrează subiectul, nu adresa: destinația depinde de rolul cititorului
-- (același interval de consultație e /consultatii pentru student și
-- /profesor/consultatii pentru coordonator), iar o cale scrisă la momentul
-- deciziei ar fi îmbătrânit odată cu rutele.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS subject_kind text
    CHECK (subject_kind IN ('request', 'invitation', 'slot')),
  ADD COLUMN IF NOT EXISTS subject_id uuid;

-- Fără cheie externă: subiectul poate fi șters (o cerere retrasă, un interval
-- anulat) fără ca notificarea care îl anunță să dispară din istoric. Ecranul
-- verifică la citire dacă mai există.
