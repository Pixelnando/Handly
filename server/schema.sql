-- Esquema do Handly (SQLite). Datas em UTC no formato ISO 'YYYY-MM-DDTHH:MM:SSZ'.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  login TEXT NOT NULL,
  cpf TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  city TEXT NOT NULL,
  uf TEXT NOT NULL,
  lat REAL,
  lng REAL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','bloqueado','excluido')),
  blocked_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
-- RN01/RN02: uma conta por pessoa; login, CPF e e-mail únicos.
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_login ON users(login);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_cpf ON users(cpf);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email ON users(lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  remember INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY,
  identifier TEXT NOT NULL,
  ip TEXT,
  success INTEGER NOT NULL,
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_login_attempts ON login_attempts(identifier, ts);

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,            -- simulado | enviado | falhou
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  norm_name TEXT NOT NULL UNIQUE,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS category_requests (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovada','rejeitada')),
  admin_note TEXT,
  category_id INTEGER REFERENCES categories(id),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS worker_profiles (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  phone TEXT NOT NULL,
  description TEXT,
  service_area TEXT NOT NULL,
  radius_km INTEGER NOT NULL DEFAULT 20,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo','bloqueado')),
  verification_status TEXT NOT NULL DEFAULT 'nao_verificado'
    CHECK (verification_status IN ('nao_verificado','verificado','rejeitado')),
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_wp_user ON worker_profiles(user_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS worker_categories (
  worker_profile_id INTEGER NOT NULL REFERENCES worker_profiles(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  PRIMARY KEY (worker_profile_id, category_id)
);

CREATE TABLE IF NOT EXISTS availability (
  id INTEGER PRIMARY KEY,
  worker_profile_id INTEGER NOT NULL REFERENCES worker_profiles(id),
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0=segunda ... 6=domingo
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_availability_wp ON availability(worker_profile_id, weekday);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  worker_id INTEGER NOT NULL REFERENCES worker_profiles(id),
  name TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  description TEXT NOT NULL,
  base_rate REAL NOT NULL CHECK (base_rate > 0),
  avg_duration_min INTEGER NOT NULL CHECK (avg_duration_min BETWEEN 15 AND 1440),
  service_area TEXT NOT NULL,
  availability_mode TEXT NOT NULL DEFAULT 'perfil' CHECK (availability_mode IN ('perfil','personalizada')),
  cancellation_fee_percent REAL NOT NULL DEFAULT 0 CHECK (cancellation_fee_percent BETWEEN 0 AND 100),
  min_notice_hours INTEGER NOT NULL DEFAULT 2,
  max_notice_hours INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
-- RN11: mesmo nome + categoria não se repete para o mesmo trabalhador (entre serviços não excluídos).
CREATE UNIQUE INDEX IF NOT EXISTS ux_services_dup ON services(worker_id, lower(name), category_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_services_cat ON services(category_id);

CREATE TABLE IF NOT EXISTS service_availability (
  id INTEGER PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES services(id),
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_form_fields (
  id INTEGER PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES services(id),
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text','textarea','number','date','select','radio','checkbox')),
  options TEXT,                    -- JSON (lista) para select/radio/checkbox
  required INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES users(id),
  worker_id INTEGER NOT NULL REFERENCES users(id),
  service_id INTEGER REFERENCES services(id),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_conv ON conversations(client_id, worker_id, ifnull(service_id, 0));

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES users(id),
  worker_id INTEGER NOT NULL REFERENCES users(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  service_name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  duration_min INTEGER NOT NULL,
  scheduled_start TEXT NOT NULL,
  scheduled_end TEXT NOT NULL,
  location TEXT NOT NULL,
  notes TEXT,
  answers_json TEXT,
  base_value REAL NOT NULL,
  agreed_value REAL,
  status TEXT NOT NULL CHECK (status IN
    ('aguardando_resposta','em_negociacao','agendada','concluida','cancelada','recusada','expirada')),
  cancellation_fee_percent REAL NOT NULL DEFAULT 0,
  cancellation_fee_amount REAL,
  cancelled_at TEXT,
  cancelled_by INTEGER REFERENCES users(id),
  cancel_reason TEXT,
  completed_at TEXT,
  conversation_id INTEGER REFERENCES conversations(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_requests_worker ON requests(worker_id, scheduled_start);
CREATE INDEX IF NOT EXISTS ix_requests_client ON requests(client_id, created_at);
CREATE INDEX IF NOT EXISTS ix_requests_status ON requests(status);

CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  request_id INTEGER NOT NULL REFERENCES requests(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  parent_id INTEGER REFERENCES proposals(id),
  kind TEXT NOT NULL CHECK (kind IN ('proposta','contraproposta')),
  service_id INTEGER NOT NULL REFERENCES services(id),
  value REAL NOT NULL,
  scheduled_start TEXT NOT NULL,
  scheduled_end TEXT NOT NULL,
  location TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','aceita','recusada','substituida','expirada','cancelada')),
  created_at TEXT NOT NULL,
  responded_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_proposals_req ON proposals(request_id);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  sender_id INTEGER REFERENCES users(id),      -- NULL = mensagem do sistema
  type TEXT NOT NULL CHECK (type IN ('texto','proposta','sistema')),
  body TEXT NOT NULL,
  proposal_id INTEGER REFERENCES proposals(id),
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_messages_conv ON messages(conversation_id, id);

-- RN41: o histórico de mensagens e propostas não pode ser alterado depois de registrado.
CREATE TRIGGER IF NOT EXISTS trg_messages_no_delete BEFORE DELETE ON messages
BEGIN SELECT RAISE(ABORT, 'O histórico de mensagens não pode ser alterado'); END;
CREATE TRIGGER IF NOT EXISTS trg_messages_no_update
BEFORE UPDATE OF conversation_id, sender_id, type, body, proposal_id, created_at ON messages
BEGIN SELECT RAISE(ABORT, 'O histórico de mensagens não pode ser alterado'); END;
CREATE TRIGGER IF NOT EXISTS trg_proposals_no_delete BEFORE DELETE ON proposals
BEGIN SELECT RAISE(ABORT, 'O histórico de propostas não pode ser alterado'); END;
CREATE TRIGGER IF NOT EXISTS trg_proposals_no_update
BEFORE UPDATE OF conversation_id, request_id, sender_id, parent_id, kind, service_id, value,
  scheduled_start, scheduled_end, location, notes, created_at ON proposals
BEGIN SELECT RAISE(ABORT, 'O histórico de propostas não pode ser alterado'); END;

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL UNIQUE REFERENCES requests(id),
  client_id INTEGER NOT NULL REFERENCES users(id),
  worker_id INTEGER NOT NULL REFERENCES users(id),
  service_id INTEGER REFERENCES services(id),
  category_id INTEGER REFERENCES categories(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  hidden_reason TEXT,
  hidden_by INTEGER REFERENCES users(id),
  hidden_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_reviews_worker ON reviews(worker_id, created_at);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  duration_days INTEGER NOT NULL,
  features TEXT NOT NULL,           -- JSON (lista)
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ativa','futura','expirada','cancelada')),
  cancelled_at TEXT,
  price_paid REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_subs_user ON subscriptions(user_id, end_at);

CREATE TABLE IF NOT EXISTS verifications (
  id INTEGER PRIMARY KEY,
  worker_profile_id INTEGER NOT NULL REFERENCES worker_profiles(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  document_type TEXT,
  document_masked TEXT,
  status TEXT NOT NULL CHECK (status IN ('aprovada','rejeitada','nao_concluida')),
  message TEXT,
  requested_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS maintenance_notices (
  id INTEGER PRIMARY KEY,
  message TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'manutencao' CHECK (kind IN ('manutencao','indisponibilidade')),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_user ON audit_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS report_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  report_type TEXT NOT NULL,        -- usuario | software | engajamento | satisfacao
  filters TEXT NOT NULL,
  format TEXT NOT NULL,             -- tela | pdf | csv | xlsx
  generated_at TEXT NOT NULL
);

-- Interações registradas pela plataforma (base do relatório de engajamento, RN28).
CREATE TABLE IF NOT EXISTS interactions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  type TEXT NOT NULL,               -- acesso | busca | visualizacao_perfil | solicitacao | mensagem | avaliacao
  category_id INTEGER REFERENCES categories(id),
  worker_id INTEGER REFERENCES users(id),
  location TEXT,
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_inter_ts ON interactions(ts);
CREATE INDEX IF NOT EXISTS ix_inter_worker ON interactions(worker_id, type);

-- Telemetria técnica (base do relatório de software).
CREATE TABLE IF NOT EXISTS request_log (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  method TEXT NOT NULL,
  route TEXT NOT NULL,
  status INTEGER NOT NULL,
  duration_ms REAL NOT NULL,
  user_id INTEGER
);
CREATE INDEX IF NOT EXISTS ix_reqlog_ts ON request_log(ts);

CREATE TABLE IF NOT EXISTS heartbeats (ts TEXT PRIMARY KEY);

CREATE TABLE IF NOT EXISTS resource_samples (
  ts TEXT PRIMARY KEY,
  load1 REAL,
  mem_mb REAL,
  cpu_pct REAL
);
