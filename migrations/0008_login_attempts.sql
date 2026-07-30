-- Câte linkuri de autentificare s-au cerut, și de unde.
--
-- Formularul nu avea nicio limită: fiecare apăsare trimitea un email nou și
-- crea un token nou. Cu adresa altcuiva, oricine putea umple o cutie poștală
-- instituțională; fără intenție rea, un utilizator nerăbdător făcea același
-- lucru la scară mică și primea cinci mesaje identice.
--
-- Se păstrează și IP-ul, ca o singură sursă să nu poată încerca adresă după
-- adresă. Rândurile se șterg la o zi — este o limită de debit, nu un jurnal de
-- audit, iar un portal public de universitate nu are motiv să țină IP-uri mai
-- mult decât îi trebuie.

CREATE TABLE login_attempts (
  id         bigserial   PRIMARY KEY,
  email      text        NOT NULL,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_login_attempts_email ON login_attempts (email, created_at DESC);
CREATE INDEX idx_login_attempts_ip    ON login_attempts (ip, created_at DESC);
