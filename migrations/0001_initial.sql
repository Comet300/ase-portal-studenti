-- =============================================================================
-- Portal Studenți — schema inițială
-- =============================================================================
-- Fără extensii: gen_random_uuid() este inclus în PostgreSQL 13+, deci schema
-- se aplică pe o imagine PostgreSQL standard.
--
-- Autorizarea se face în aplicație, nu prin row-level security: fiecare
-- interogare cu proprietar poartă condiția în aceeași instrucțiune.
-- =============================================================================

-- --- utilizatori -------------------------------------------------------------

CREATE TABLE utilizatori (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL UNIQUE,
  nume               text NOT NULL,
  rol                text NOT NULL CHECK (rol IN ('student', 'profesor', 'director')),

  -- student
  numar_matricol     text,
  program            text CHECK (program IN ('licenta', 'master')),
  specializare       text,
  an_studiu          integer,

  -- cadru didactic
  titlu_academic     text,
  departament        text,
  capacitate_licenta integer NOT NULL DEFAULT 0,
  capacitate_master  integer NOT NULL DEFAULT 0,
  birou              text,
  cont_demo          boolean NOT NULL DEFAULT false,

  creat_la           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_utilizatori_rol ON utilizatori (rol);

-- --- autentificare -----------------------------------------------------------

-- Tokenul ajunge la utilizator prin email; în bază păstrăm doar amprenta lui,
-- ca o citire a tabelei să nu permită autentificarea nimănui.
CREATE TABLE tokenuri_magic_link (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  redirect_la text,
  expira_la   timestamptz NOT NULL,
  folosit_la  timestamptz,
  creat_la    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tokenuri_expira ON tokenuri_magic_link (expira_la);

CREATE TABLE sesiuni (
  id            text PRIMARY KEY,
  utilizator_id uuid NOT NULL REFERENCES utilizatori(id) ON DELETE CASCADE,
  expira_la     timestamptz NOT NULL,
  creat_la      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sesiuni_utilizator ON sesiuni (utilizator_id);

-- --- calendarul sesiunii -----------------------------------------------------

CREATE TABLE etape_sesiune (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ordine       integer NOT NULL,
  titlu        text NOT NULL,
  descriere    text,
  interval_text text NOT NULL,
  data_inceput date,
  data_sfarsit date
);

-- --- teme propuse ------------------------------------------------------------

CREATE TABLE teme (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profesor_id  uuid NOT NULL REFERENCES utilizatori(id) ON DELETE CASCADE,
  titlu        text NOT NULL,
  descriere    text,
  nivel        text NOT NULL CHECK (nivel IN ('licenta', 'master')),
  metode       text,
  prerechizite text,
  locuri       integer NOT NULL DEFAULT 1,
  activa       boolean NOT NULL DEFAULT true,
  creat_la     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_teme_profesor ON teme (profesor_id);

-- --- cereri ------------------------------------------------------------------

CREATE TABLE cereri (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numar             text NOT NULL UNIQUE,
  student_id        uuid NOT NULL REFERENCES utilizatori(id) ON DELETE CASCADE,
  profesor_id       uuid NOT NULL REFERENCES utilizatori(id) ON DELETE CASCADE,
  tema_id           uuid REFERENCES teme(id) ON DELETE SET NULL,
  titlu_ro          text NOT NULL,
  titlu_en          text,
  scop_obiective    text NOT NULL,
  status            text NOT NULL DEFAULT 'in_asteptare'
                    CHECK (status IN ('ciorna', 'in_asteptare', 'aprobata', 'respinsa')),
  motiv_respingere  text,
  depusa_la         timestamptz NOT NULL DEFAULT now(),
  decisa_la         timestamptz,
  actualizat_la     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cereri_student ON cereri (student_id);
CREATE INDEX idx_cereri_profesor ON cereri (profesor_id, status);

-- Un student poate avea o singură cerere activă (nerespinsă) la un moment dat.
CREATE UNIQUE INDEX idx_cereri_una_activa
  ON cereri (student_id) WHERE status IN ('in_asteptare', 'aprobata');

-- --- jaloane (cronologia editabilă) ------------------------------------------

CREATE TABLE jaloane (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cerere_id   uuid NOT NULL REFERENCES cereri(id) ON DELETE CASCADE,
  titlu       text NOT NULL,
  descriere   text,
  termen      date,
  status      text NOT NULL DEFAULT 'planificat'
              CHECK (status IN ('planificat', 'in_lucru', 'finalizat')),
  ordine      integer NOT NULL DEFAULT 0,
  creat_la    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_jaloane_cerere ON jaloane (cerere_id, ordine);

-- --- consultații -------------------------------------------------------------

CREATE TABLE sloturi_consultatii (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profesor_id uuid NOT NULL REFERENCES utilizatori(id) ON DELETE CASCADE,
  start_la    timestamptz NOT NULL,
  sfarsit_la  timestamptz NOT NULL,
  mod         text NOT NULL DEFAULT 'fizic' CHECK (mod IN ('fizic', 'online')),
  locatie     text,
  link_online text,
  capacitate  integer NOT NULL DEFAULT 1,
  anulat      boolean NOT NULL DEFAULT false,
  creat_la    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sloturi_profesor ON sloturi_consultatii (profesor_id, start_la);

CREATE TABLE rezervari (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id    uuid NOT NULL REFERENCES sloturi_consultatii(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES utilizatori(id) ON DELETE CASCADE,
  subiect    text,
  status     text NOT NULL DEFAULT 'rezervata' CHECK (status IN ('rezervata', 'anulata')),
  creat_la   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_id, student_id)
);

CREATE INDEX idx_rezervari_student ON rezervari (student_id);

-- --- mesagerie ---------------------------------------------------------------

CREATE TABLE conversatii (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     uuid NOT NULL REFERENCES utilizatori(id) ON DELETE CASCADE,
  profesor_id    uuid NOT NULL REFERENCES utilizatori(id) ON DELETE CASCADE,
  ultim_mesaj_la timestamptz,
  creat_la       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, profesor_id)
);

CREATE INDEX idx_conversatii_profesor ON conversatii (profesor_id, ultim_mesaj_la DESC);
CREATE INDEX idx_conversatii_student ON conversatii (student_id, ultim_mesaj_la DESC);

CREATE TABLE mesaje (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversatie_id uuid NOT NULL REFERENCES conversatii(id) ON DELETE CASCADE,
  expeditor_id   uuid NOT NULL REFERENCES utilizatori(id) ON DELETE CASCADE,
  corp           text NOT NULL,
  citit_la       timestamptz,
  creat_la       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mesaje_conversatie ON mesaje (conversatie_id, creat_la);

-- --- fișiere -----------------------------------------------------------------

CREATE TABLE fisiere (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incarcat_de    uuid NOT NULL REFERENCES utilizatori(id) ON DELETE CASCADE,
  conversatie_id uuid REFERENCES conversatii(id) ON DELETE CASCADE,
  mesaj_id       uuid REFERENCES mesaje(id) ON DELETE CASCADE,
  nume_original  text NOT NULL,
  nume_stocat    text NOT NULL,
  mime           text,
  marime         bigint,
  creat_la       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_fisiere_conversatie ON fisiere (conversatie_id);
