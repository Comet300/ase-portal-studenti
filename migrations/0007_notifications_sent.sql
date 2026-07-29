-- Ce s-a trimis deja, ca să nu se trimită de două ori.
--
-- Portalul anunța termenele numai după ce treceau: cererea expirată, invitația
-- expirată. Un avertisment înainte — „mai ai două zile” — este singurul care
-- schimbă ceva, dar are o problemă pe care anunțul de după nu o are: poate fi
-- retrimis. Măturarea rulează la fiecare cerere (limitată), și acum și dintr-un
-- planificator; fără o urmă a ce s-a trimis, un student ar primi același
-- memento de zece ori pe zi.
--
-- Cheia include ziua: un memento pentru „T-3” și unul pentru „T-0” sunt două
-- notificări diferite despre același termen, iar un an mai târziu aceeași
-- combinație poate reapărea legitim.

CREATE TABLE notifications_sent (
  user_id  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind     text        NOT NULL,
  ref_id   uuid        NOT NULL,
  sent_on  date        NOT NULL DEFAULT current_date,
  sent_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, ref_id, sent_on)
);

-- Curățenia periodică se face după dată, deci indexul e pe ea.
CREATE INDEX idx_notifications_sent_on ON notifications_sent (sent_on);
