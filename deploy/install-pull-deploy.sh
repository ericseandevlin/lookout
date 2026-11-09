#!/usr/bin/env bash
# One-time install of the pull-based deploy (#18). Run as root on the VPS, after the registry login:
#   DOCKER_CONFIG=/root/.config/lookout-ghcr docker login ghcr.io -u ericseandevlin --password-stdin
# Usage: install-pull-deploy.sh          staging: /root/bin/lookout-pull-deploy, a clone in /root/src/lookout-stage,
#                                        the cron line, one deploy by hand, and the old staging script swapped for
#                                        a stub (so agents' `sudo lookout-deploy-staging` can't undo a CI deploy).
#        install-pull-deploy.sh prod     production, separately and only once release/prod exists and is protected
#                                        on GitHub. Its first run deploys whatever :prod holds.
# Safe to run again.
set -euo pipefail
ch=${1:-stage}
case "$ch" in
  stage) dir=/opt/lookout-staging; want=lookout:staging ;;
  prod) dir=/opt/lookout; want=lookout:latest ;;
  *) echo "usage: $0 [prod]" >&2; exit 2 ;;
esac
cfg=/root/.config/lookout-ghcr
repo=/root/src/lookout-$ch
remote=${LOOKOUT_REMOTE:-git@github-lookout-read:ericseandevlin/lookout.git}   # read-only deploy key in /root/.ssh
cron="*/2 * * * * flock -n /run/lookout-pull-$ch.lock /root/bin/lookout-pull-deploy $ch >> /var/log/lookout-pull-$ch.log 2>&1"

[ "$(id -u)" = 0 ] || { echo "Run as root." >&2; exit 1; }
chmod 700 "$cfg" 2>/dev/null || true
grep -q '"ghcr.io"' "$cfg/config.json" 2>/dev/null || { echo "No registry login in $cfg yet. Do the docker login step first." >&2; exit 1; }
chmod 600 "$cfg/config.json"
image=$(sed -n 's/^LOOKOUT_IMAGE=//p' "$dir/.env"); image=${image:-lookout:latest}
[ "$image" = "$want" ] || { echo "$dir/.env runs $image, expected $want. Stopping." >&2; exit 1; }
if [ "$ch" = prod ]; then
  curl -fsS https://api.github.com/repos/ericseandevlin/lookout/branches/release%2Fprod | grep -q '"protected": *true' \
    || { echo "release/prod is missing or not protected on GitHub. Protect it (only Eric can push) first." >&2; exit 1; }
fi

[ -d "$repo/.git" ] || git clone -q "$remote" "$repo"
git -C "$repo" fetch -q origin
mkdir -p /root/bin
git -C "$repo" show origin/main:deploy/pull-deploy.sh > /root/bin/lookout-pull-deploy
chmod 700 /root/bin/lookout-pull-deploy

echo "First deploy (pulls ghcr.io/ericseandevlin/lookout:$ch):"
flock /run/lookout-pull-$ch.lock /root/bin/lookout-pull-deploy "$ch" || { echo "First deploy failed; cron not installed. Output above." >&2; exit 1; }
(crontab -l 2>/dev/null | grep -v "lookout-pull-deploy $ch"; echo "$cron") | crontab -

if [ "$ch" = stage ] && ! grep -q 'Staging builds in CI' /root/bin/lookout-deploy-staging 2>/dev/null; then
  [ -f /root/bin/lookout-deploy-staging ] && cp -p /root/bin/lookout-deploy-staging /root/bin/lookout-deploy-staging.pre-ci
  cat > /root/bin/lookout-deploy-staging <<'STUB'
#!/usr/bin/env bash
# Staging builds in CI now (#18). Merging to main deploys staging by itself; previews are listed in
# deploy/preview-branches on main. This only pulls a fresh :stage image now instead of waiting for cron.
# The old build-on-the-server script is kept as lookout-deploy-staging.pre-ci.
echo "Staging builds in CI now (#18): merging to main deploys it within about 10 minutes. Previews: deploy/preview-branches."
exec flock /run/lookout-pull-stage.lock /root/bin/lookout-pull-deploy stage
STUB
  chmod 755 /root/bin/lookout-deploy-staging
  echo "Old staging script saved as /root/bin/lookout-deploy-staging.pre-ci; the new one only pulls."
fi
if [ "$ch" = stage ] && [ -s "$dir/PREVIEW_BRANCHES" ]; then
  echo "Previews now come from deploy/preview-branches in the repo. The old server list ($dir/PREVIEW_BRANCHES) is no longer read:"
  sed 's/^/  /' "$dir/PREVIEW_BRANCHES"
fi
echo "Installed. $ch follows ghcr.io/ericseandevlin/lookout:$ch. Log: /var/log/lookout-pull-$ch.log"
