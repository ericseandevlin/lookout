#!/bin/sh
# Writes .env for compose.yaml from deploy/selfhost.env.example, with random secrets and you as admin.
#   scripts/selfhost-env.sh you@example.com
# Refuses to overwrite an existing .env (a new APP_SECRET would make saved keys unreadable).
set -eu
cd "$(dirname "$0")/.."

email=${1:-}
case "$email" in
  *[!A-Za-z0-9._%+@-]*) echo "That email has characters this script won't handle; set ADMIN_EMAILS in .env by hand." >&2; exit 1 ;;
  *@*.*) ;;
  *) echo "usage: scripts/selfhost-env.sh you@example.com" >&2; exit 1 ;;
esac
if [ -e .env ]; then
  echo ".env already exists; leaving it alone. Delete it first to start over." >&2
  exit 1
fi

rand() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }

umask 077
sed -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(rand)|" \
    -e "s|^SEARXNG_SECRET=.*|SEARXNG_SECRET=$(rand)|" \
    -e "s|^APP_SECRET=.*|APP_SECRET=$(rand)|" \
    -e "s|^ADMIN_EMAILS=.*|ADMIN_EMAILS=$email|" \
    deploy/selfhost.env.example > .env

echo "Wrote .env (admin: $email). Add your AI key to AI_API_KEY there, or later in Admin > AI settings."
echo "Next: docker compose up -d --build, then open http://localhost:3000"
