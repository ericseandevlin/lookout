#!/usr/bin/env bash
# One-time install of the pull-based staging deploy (#18). Run as root on the VPS, after the registry login:
#   DOCKER_CONFIG=/root/.config/lookout-ghcr docker login ghcr.io -u ericseandevlin --password-stdin
# Installs /root/bin/lookout-pull-deploy, a clone in /root/src/lookout-stage, and the cron line, then runs
# one deploy by hand so you see it work. Safe to run again. Staging only; it never installs prod.
set -euo pipefail
cfg=/root/.config/lookout-ghcr
repo=/root/src/lookout-stage
src=${LOOKOUT_SRC:-/root/src/lookout-prod}
cron='*/2 * * * * flock -n /run/lookout-pull-stage.lock /root/bin/lookout-pull-deploy stage >> /var/log/lookout-pull-stage.log 2>&1'

[ "$(id -u)" = 0 ] || { echo "Run as root." >&2; exit 1; }
chmod 700 "$cfg" 2>/dev/null || true
grep -q '"ghcr.io"' "$cfg/config.json" 2>/dev/null || { echo "No registry login in $cfg yet. Do the docker login step first." >&2; exit 1; }
chmod 600 "$cfg/config.json"
grep -q '^LOOKOUT_IMAGE=lookout:staging$' /opt/lookout-staging/.env || { echo "/opt/lookout-staging/.env must set LOOKOUT_IMAGE=lookout:staging. Stopping." >&2; exit 1; }

if [ ! -d "$repo/.git" ]; then
  git clone -q "$(git -C "$src" remote get-url origin)" "$repo"
fi
git -C "$repo" fetch -q origin
mkdir -p /root/bin
git -C "$repo" show origin/main:deploy/pull-deploy.sh > /root/bin/lookout-pull-deploy
chmod 700 /root/bin/lookout-pull-deploy

echo "First deploy (pulls ghcr.io/ericseandevlin/lookout:stage):"
/root/bin/lookout-pull-deploy stage || { echo "First deploy failed; cron not installed. Output above." >&2; exit 1; }
(crontab -l 2>/dev/null | grep -v 'lookout-pull-deploy stage'; echo "$cron") | crontab -
echo "Installed. Staging now follows release/stage. Log: /var/log/lookout-pull-stage.log"
