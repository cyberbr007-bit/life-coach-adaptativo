#!/usr/bin/env sh
set -eu
# Read-only; never prints environment variables, credentials or service contents.
printf '== Host ==\n'
uname -sr
printf '== Capacity ==\n'
free -m
df -h /
printf '== Containers ==\n'
if command -v docker >/dev/null 2>&1; then
  docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}'
  docker compose version
else
  printf 'Docker is not installed\n'
fi
printf '== Listeners ==\n'
if command -v ss >/dev/null 2>&1; then ss -lnt; fi
printf '== Runtime ==\n'
if command -v node >/dev/null 2>&1; then node --version; fi
printf '== End ==\n'

