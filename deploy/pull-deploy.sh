#!/usr/bin/env bash
# Pull-based deploy, run on the VPS by root cron. The Release workflow (.github/workflows/release.yml) pushes
# ghcr.io/ericseandevlin/lookout:<channel>; this notices a new image, pulls it, restarts that stack, checks
# /api/health and rolls back to the previous image if the check fails. GitHub never connects to the server.
# Usage: pull-deploy.sh stage    staging (/opt/lookout-staging, port 3201), follows release/stage
#        pull-deploy.sh prod     production (/opt/lookout, port 3200), follows release/prod
# Needs: a read-only registry login (classic token with read:packages only) in $DOCKER_CONFIG, made once with
#   DOCKER_CONFIG=/root/.config/lookout-ghcr docker login ghcr.io -u ericseandevlin
# and a clone of the repo at $LOOKOUT_REPO (deploy key) for the compose files at the image's commit.
# Cron (root): */2 * * * * flock -n /run/lookout-pull-stage.lock /root/bin/lookout-pull-deploy stage >> /var/log/lookout-pull-stage.log 2>&1
set -euo pipefail
ch=${1:-}
case "$ch" in
  stage) dir=/opt/lookout-staging; tag=lookout:staging; port=3201 ;;
  prod) dir=/opt/lookout; tag=lookout:latest; port=3200 ;;
  *) echo "usage: $0 stage|prod" >&2; exit 2 ;;
esac
image=ghcr.io/ericseandevlin/lookout:$ch
repo=${LOOKOUT_REPO:-/root/src/lookout-$ch}
export DOCKER_CONFIG=${DOCKER_CONFIG:-/root/.config/lookout-ghcr}
log() { echo "$(date -u +%FT%TZ) [$ch] $*"; }

# A pull of an unchanged tag only fetches the manifest, so running every two minutes is cheap.
docker pull -q "$image" >/dev/null
new=$(docker image inspect -f '{{.Id}}' "$image")
cur=$(docker image inspect -f '{{.Id}}' "$tag" 2>/dev/null || true)
[ "$new" != "$cur" ] || exit 0
rev=$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
[[ "$rev" =~ ^[0-9a-f]{40}$ ]] || { log "Refusing: image has no commit label"; exit 1; }
sha=${rev::7}
log "New image $sha, deploying"

git -C "$repo" fetch -q origin
git -C "$repo" checkout -q --detach "$rev"
mkdir -p "$dir/searxng"
install -m 644 "$repo/deploy/docker-compose.yml" "$dir/docker-compose.yml"
install -m 644 "$repo/deploy/searxng/settings.yml" "$dir/searxng/settings.yml"
[ -f "$dir/.env.searxng" ] || (umask 077; echo "SEARXNG_SECRET=$(openssl rand -hex 24)" > "$dir/.env.searxng")
if [ "$ch" = prod ]; then
  install -m 700 "$repo/deploy/backup.sh" "$dir/backup.sh"
  # Nightly backup at 07:15 UTC (3:15 AM New York); idempotent.
  (crontab -l 2>/dev/null | grep -v 'lookout/backup.sh'; echo "15 7 * * * $dir/backup.sh >> $dir/backups.log 2>&1") | crontab -
fi

prev=lookout:previous-$ch
[ -z "$cur" ] || docker tag "$tag" "$prev"
docker tag "$image" "$tag"
healthy() {
  for _ in $(seq 1 20); do
    sleep 5
    curl -fsS "http://172.17.0.1:$port/api/health" >/dev/null 2>&1 && return 0
  done
  return 1
}
(cd "$dir" && docker compose up -d)
if ! healthy; then
  if [ -n "$cur" ]; then
    log "Health check failed for $sha, rolling back"
    docker tag "$prev" "$tag"
    (cd "$dir" && docker compose up -d)
  fi
  log "FAILED: $sha is not healthy"
  exit 1
fi
docker image prune -f >/dev/null
echo "$sha $(date -u +%FT%TZ)" > "$dir/DEPLOYED"
log "Deployed $sha: $(curl -fsS "http://172.17.0.1:$port/api/health")"

# Release notes for the weekly meeting (Quill reads these): what is on staging and not yet on prod,
# and the issue numbers already shipped (the GitHub sync marks those done).
if git -C "$repo" rev-parse -q --verify origin/release/prod >/dev/null; then
  git -C "$repo" log --no-merges --date=short --format='%h %ad %s' origin/release/prod..origin/release/stage > /opt/lookout-staging/PENDING.txt
  git -C "$repo" log --format='%s' origin/release/prod | { grep -oE '\(#[0-9]+\)' || true; } | tr -d '(#)' | sort -un > /opt/lookout-staging/RELEASED.txt
fi
