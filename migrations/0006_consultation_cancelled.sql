-- O consultație anulată este un eveniment ca oricare altul din firul perechii.
--
-- Anularea nu spunea nimănui nimic: un UPDATE pe rezervare și atât, deși
-- dialogul de confirmare promitea studentului că „coordonatorul vede anularea”.
-- Acum pleacă email, invitație de anulare în calendar și un eveniment în fir —
-- iar tipul lui trebuie să existe în constrângere, altfel `postEvent` îl
-- respinge în tăcere, pentru că înghite orice eroare ca să nu strice acțiunea
-- deja comisă.

ALTER TABLE messages DROP CONSTRAINT messages_event_type_check;

ALTER TABLE messages ADD CONSTRAINT messages_event_type_check
  CHECK (event_type IN (
    'request_approved', 'request_rejected', 'request_expired', 'request_withdrawn',
    'invitation_sent', 'invitation_accepted', 'invitation_declined',
    'consultation_scheduled', 'consultation_cancelled', 'seats_granted'
  ));
