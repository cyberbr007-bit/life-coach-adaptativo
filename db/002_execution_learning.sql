CREATE TABLE IF NOT EXISTS lc_verification_standards(
  id text PRIMARY KEY, digest text NOT NULL, criteria jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION lc_protect_standard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'STANDARD_IMMUTABLE'; END;
$$;
DROP TRIGGER IF EXISTS lc_standard_immutable ON lc_verification_standards;
CREATE TRIGGER lc_standard_immutable BEFORE UPDATE OR DELETE ON lc_verification_standards
FOR EACH ROW EXECUTE FUNCTION lc_protect_standard();
CREATE TABLE IF NOT EXISTS lc_verification_runs(
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES lc_user(id),
  standard_id text NOT NULL REFERENCES lc_verification_standards(id),
  results jsonb NOT NULL, passed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lc_learning_incidents(
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES lc_user(id),
  event_id text REFERENCES lc_events(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('defect','opportunity','observation')),
  fingerprint text NOT NULL, summary text NOT NULL, evidence_runs jsonb NOT NULL,
  confirmed boolean NOT NULL, status text NOT NULL DEFAULT 'candidate',
  scope text NOT NULL, rollback text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lc_rule_candidates(
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES lc_user(id),
  fingerprint text NOT NULL, proposed_rule text NOT NULL, evidence_ids jsonb NOT NULL,
  status text NOT NULL DEFAULT 'candidate' CHECK(status='candidate'),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,fingerprint)
);
INSERT INTO lc_migrations(version) VALUES(2) ON CONFLICT DO NOTHING;

