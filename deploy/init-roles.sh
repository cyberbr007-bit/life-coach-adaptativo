#!/usr/bin/env bash
set -euo pipefail
migrator_password="$(cat "$MIGRATOR_PASSWORD_FILE")"
runtime_password="$(cat "$APP_PASSWORD_FILE")"
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 --set=migrator_password="$migrator_password" --set=runtime_password="$runtime_password" <<'SQL'
CREATE ROLE lc_owner LOGIN PASSWORD :'migrator_password';
CREATE ROLE lc_runtime LOGIN PASSWORD :'runtime_password';
GRANT CONNECT ON DATABASE life_coach TO lc_owner, lc_runtime;
GRANT USAGE, CREATE ON SCHEMA public TO lc_owner;
GRANT USAGE ON SCHEMA public TO lc_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE lc_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lc_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE lc_owner IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO lc_runtime;
SQL

