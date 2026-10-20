CREATE TABLE IF NOT EXISTS lc_migrations (
  version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lc_user (
  id text PRIMARY KEY, telegram_id text NOT NULL UNIQUE,
  chat_id text NOT NULL, timezone text NOT NULL DEFAULT 'America/Belem',
  proactive_paused boolean NOT NULL DEFAULT true,
  learning_paused boolean NOT NULL DEFAULT true,
  epoch integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lc_updates (
  update_id text PRIMARY KEY, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lc_events (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES lc_user(id),
  source_id text NOT NULL UNIQUE, type text NOT NULL, payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lc_memory (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES lc_user(id),
  kind text NOT NULL CHECK (kind IN ('fact','state','goal','preference','boundary')),
  name text NOT NULL, current_version integer NOT NULL DEFAULT 1,
  UNIQUE(user_id,kind,name)
);
CREATE TABLE IF NOT EXISTS lc_memory_versions (
  memory_id text NOT NULL REFERENCES lc_memory(id) ON DELETE CASCADE,
  version integer NOT NULL, value text NOT NULL,
  event_id text REFERENCES lc_events(id) ON DELETE CASCADE,
  valid_from timestamptz NOT NULL DEFAULT now(), valid_to timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now(), origin text NOT NULL DEFAULT 'user_declared',
  PRIMARY KEY(memory_id,version)
);
CREATE TABLE IF NOT EXISTS lc_jobs (
  id text PRIMARY KEY, event_id text NOT NULL UNIQUE REFERENCES lc_events(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES lc_user(id), epoch integer NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','done','failed','cancelled')),
  lease_token text, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0,
  error_code text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lc_jobs_claim ON lc_jobs(state,lease_until,created_at);
CREATE TABLE IF NOT EXISTS lc_runs (
  id text PRIMARY KEY, job_id text NOT NULL REFERENCES lc_jobs(id) ON DELETE CASCADE,
  context jsonb NOT NULL, release text NOT NULL,
  status text NOT NULL, model text, request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lc_outbox (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES lc_user(id),
  dedupe_key text NOT NULL UNIQUE, payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','sent','failed','cancelled')),
  proactive boolean NOT NULL DEFAULT false, epoch integer,
  attempts integer NOT NULL DEFAULT 0, next_attempt timestamptz NOT NULL DEFAULT now(),
  lease_token text, lease_until timestamptz, telegram_message_id text, error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lc_actions (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES lc_user(id),
  type text NOT NULL CHECK (type IN ('delete_all')),
  expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE IF NOT EXISTS lc_audit (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES lc_user(id),
  type text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lc_runtime (
  key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO lc_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;

