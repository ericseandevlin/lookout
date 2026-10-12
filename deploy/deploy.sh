#!/usr/bin/env bash
# Build the image for the VPS (linux/amd64), ship it over SSH, restart the stack.
# Usage: deploy/deploy.sh            production (lookout.ericdevlin.co, /opt/lookout, port 3200)
#        deploy/deploy.sh staging    staging (staging.lookout.ericdevlin.co, /opt/lookout-staging, port 3201)
set -euo pipefail
SSH="${LOOKOUT_SSH:-ssh -i $HOME/.ssh/hermes_vps root@2.25.107.193}"
cd "$(dirname "$0")/.."
if [ "${1:-production}" = "staging" ]; then
  dir=/opt/lookout-staging; tag=lookout:staging; port=3201
else
  dir="${LOOKOUT_DIR:-/opt/lookout}"; tag=lookout:latest; port=3200
fi
docker buildx build --platform linux/amd64 -t "$tag" --load .
docker save "$tag" | gzip | $SSH 'gunzip | docker load'
$SSH "mkdir -p $dir/searxng"
cat deploy/docker-compose.yml | $SSH "cat > $dir/docker-compose.yml"
cat deploy/searxng/settings.yml | $SSH "cat > $dir/searxng/settings.yml"
$SSH "cd $dir && [ -f .env.searxng ] || (umask 077; echo SEARXNG_SECRET=\$(openssl rand -hex 24) > .env.searxng)"
if [ "$tag" = "lookout:latest" ]; then
  cat deploy/backup.sh | $SSH "cat > $dir/backup.sh && chmod 700 $dir/backup.sh"
  # Nightly backup at 07:15 UTC (3:15 AM New York); idempotent.
  $SSH "(crontab -l 2>/dev/null | grep -v 'lookout/backup.sh'; echo '15 7 * * * $dir/backup.sh >> $dir/backups.log 2>&1') | crontab -"
fi
$SSH "cd $dir && docker compose up -d && docker image prune -f >/dev/null"
echo "Deployed $tag. Health:"
sleep 8
$SSH "curl -fsS http://172.17.0.1:$port/api/health"
