#!/usr/bin/env bash
# Dedicated rootful Linux Compose deployment; never changes secret contents.
set -euo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
if [[ "$EUID" != 0 ]]; then
    echo 'Execute como root na instalação Compose dedicada.' >&2
    exit 1
fi
files=(postgres.password migrator.password app.password migrator-url)
for name in "${files[@]}"; do
    if [[ ! -f "secrets/$name" || -L "secrets/$name" ]]; then
        echo 'Arquivo de segredo ausente ou link simbólico; nenhuma permissão alterada.' >&2
        exit 1
    fi
done
image="$(docker compose config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["db"]["image"])')"
docker compose pull db
ids="$(docker run --rm --entrypoint /bin/sh "$image" -c 'id -u postgres; id -g postgres')"
mapfile -t postgres_ids <<< "$ids"
if [[ "${#postgres_ids[@]}" != 2 || ! "${postgres_ids[0]}" =~ ^[1-9][0-9]*$ || ! "${postgres_ids[1]}" =~ ^[1-9][0-9]*$ ]]; then
    echo 'UID/GID PostgreSQL inválidos; nenhuma permissão alterada.' >&2
    exit 1
fi
for name in postgres.password migrator.password app.password; do
    chown -- "${postgres_ids[0]}:${postgres_ids[1]}" "secrets/$name"
    chmod 0600 -- "secrets/$name"
done
chown 1000:1000 secrets/migrator-url
chmod 0600 secrets/migrator-url
docker compose run --rm --no-deps --user "${postgres_ids[0]}:${postgres_ids[1]}" --entrypoint /bin/sh db -c \
    'test -r "$POSTGRES_PASSWORD_FILE" && test -r "$MIGRATOR_PASSWORD_FILE" && test -r "$APP_PASSWORD_FILE"'
echo 'Permissões verificadas no container PostgreSQL. Conteúdos preservados; banco não iniciado.'
