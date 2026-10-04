#!/usr/bin/env bash
# Build the image for the VPS (linux/amd64), ship it over SSH, restart the app.
# Usage: deploy/deploy.sh   (needs SSH access as configured in LOOKOUT_SSH)
set -euo pipefail
SSH="${LOOKOUT_SSH:-ssh -i $HOME/.ssh/hermes_vps root@2.25.107.193}"
cd "$(dirname "$0")/.."
docker buildx build --platform linux/amd64 -t lookout:latest --load .
docker save lookout:latest | gzip | $SSH 'gunzip | docker load'
scp_target="${LOOKOUT_DIR:-/opt/lookout}"
$SSH "mkdir -p $scp_target" 
cat deploy/docker-compose.yml | $SSH "cat > $scp_target/docker-compose.yml"
$SSH "mkdir -p $scp_target/searxng"
cat deploy/searxng/settings.yml | $SSH "cat > $scp_target/searxng/settings.yml"
$SSH "cd $scp_target && [ -f .env.searxng ] || (umask 077; echo SEARXNG_SECRET=\$(openssl rand -hex 24) > .env.searxng)"
$SSH "cd $scp_target && docker compose up -d && docker image prune -f >/dev/null"
echo "Deployed. Health:"
sleep 8
$SSH "curl -fsS http://172.17.0.1:3200/api/health"
