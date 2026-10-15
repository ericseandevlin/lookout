#!/usr/bin/env bash
# Build the image for the VPS (linux/amd64), ship it over SSH, restart the stack.
# Usage: deploy/deploy.sh            production (lookout.ericdevlin.co, /opt/lookout, port 3200), from branch `prod`
#        deploy/deploy.sh staging    staging (staging.lookout.ericdevlin.co, /opt/lookout-staging, port 3201), from branch `main`
# Flow: local dev (npm run dev, feature branches) -> main -> staging -> reviewed at the weekly release meeting ->
# fast-forward `prod` to the approved commit -> production. Each deploy builds exactly a pushed, clean commit.
set -euo pipefail
SSH="${LOOKOUT_SSH:-ssh -i $HOME/.ssh/hermes_vps root@2.25.107.193}"
cd "$(dirname "$0")/.."
if [ "${1:-production}" = "staging" ]; then
  dir=/opt/lookout-staging; tag=lookout:staging; port=3201
else
  dir="${LOOKOUT_DIR:-/opt/lookout}"; tag=lookout:latest; port=3200
fi
want=$([ "$tag" = "lookout:latest" ] && echo prod || echo main)
branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" = "$want" ] || { echo "Refusing: $tag deploys from branch '$want', you're on '$branch'." >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Refusing: uncommitted changes. Commit or stash first." >&2; exit 1; }
git fetch -q origin "$want"
[ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$want")" ] || { echo "Refusing: $want isn't pushed (or is behind origin)." >&2; exit 1; }
sha=$(git rev-parse --short HEAD)
docker buildx build --platform linux/amd64 -t "$tag" --label "co.ericdevlin.commit=$sha" --load .
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
echo "Deployed $tag at $sha. Health:"
sleep 8
$SSH "curl -fsS http://172.17.0.1:$port/api/health"
# Release notes for the weekly meeting (Quill reads these): what is on staging and not yet on prod.
git fetch -q origin main prod
echo "$sha $(date -u +%FT%TZ)" | $SSH "cat > $dir/DEPLOYED"
git log --no-merges --date=short --format='%h %ad %s' origin/prod..origin/main | $SSH "cat > /opt/lookout-staging/PENDING.txt"
# Issue numbers already shipped (hotfixes included, whatever their hash): the Leantime sync marks these Done.
git log --format='%s' origin/prod | grep -oE '\(#[0-9]+\)' | tr -d '(#)' | sort -un | $SSH "cat > /opt/lookout-staging/RELEASED.txt"
