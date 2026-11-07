#!/usr/bin/env bash
# Incident drill steps on staging, for agents without root or Docker (#275). Runs the safe parts of
# docs/incident-response.md step 2 against /opt/lookout-staging only: no stop, no sign-outs, no key changes.
# Usage: drill-staging.sh snapshot           backup.sh into backups/, renamed *-drill-HHMMSS so later runs keep them
#        drill-staging.sh logs               the app's last 72 hours of logs into backups/drill-app-*.log
#        drill-staging.sh reencrypt-dry-run  scripts/reencrypt.mjs --dry-run in a one-off container (counts only)
#        drill-staging.sh health             /api/health on port 3201
# Each step prints what it made and how long it took, never file contents, and adds one line to DRILL.txt in the
# staging directory. The directory and port are fixed, so this cannot reach prod.
# Install (root, once): install -m 700 deploy/drill-staging.sh /root/bin/lookout-drill-staging
# and allow agents exactly these four commands (visudo -f /etc/sudoers.d/lookout-drill):
#   claude ALL=(root) NOPASSWD: /root/bin/lookout-drill-staging snapshot, /root/bin/lookout-drill-staging logs, \
#     /root/bin/lookout-drill-staging reencrypt-dry-run, /root/bin/lookout-drill-staging health
set -euo pipefail
dir=/opt/lookout-staging
port=3201
# backup.sh comes from the staging clone pull-deploy.sh keeps, at the commit staging runs.
repo=/root/src/lookout-stage
cd "$dir"
umask 077
exec 9>/run/lookout-drill-staging.lock
flock -n 9 || { echo "Another drill step is running." >&2; exit 1; }

log=$dir/DRILL.txt
start=$(date +%s)
step=${1:-}
done_() {
  local line
  line="$(date -u +%FT%TZ) $step $(( $(date +%s) - start ))s $*"
  echo "$line"
  (umask 022; echo "$line" >> "$log")
}
size() { du -h "$1" | cut -f1; }

case "$step" in
  snapshot)
    ts=$(date -u +%H%M%S)
    stamp=$(date -u +%Y%m%d)
    LOOKOUT_DIR=$dir bash "$repo/deploy/backup.sh"
    mv "backups/db-$stamp.dump" "backups/db-$stamp-drill-$ts.dump"
    mv "backups/files-$stamp.tgz" "backups/files-$stamp-drill-$ts.tgz"
    done_ "db-$stamp-drill-$ts.dump $(size "backups/db-$stamp-drill-$ts.dump"), files-$stamp-drill-$ts.tgz $(size "backups/files-$stamp-drill-$ts.tgz")"
    ;;
  logs)
    mkdir -p backups
    out=backups/drill-app-$(date -u +%Y%m%d-%H%M%S).log
    docker compose logs --no-color --since 72h app > "$out"
    done_ "$out $(wc -l < "$out") lines $(size "$out")"
    ;;
  reencrypt-dry-run)
    # An image from before --dry-run would ignore the flag and write, so check the script knows it first.
    out=$(docker compose run --rm -T app sh -c \
      'grep -q -- "--dry-run" scripts/reencrypt.mjs || { echo "This image has no reencrypt --dry-run; deploy staging first."; exit 3; }
       exec node scripts/reencrypt.mjs --dry-run' 2>&1) || { echo "$out" >&2; done_ "failed"; exit 1; }
    echo "$out"
    done_ "$(echo "$out" | grep -E '^(Secrets|Uploads):' | paste -sd' ' -)"
    ;;
  health)
    done_ "$(curl -fsS "http://172.17.0.1:$port/api/health" 2>/dev/null || echo unreachable)"
    ;;
  *)
    echo "usage: $0 snapshot|logs|reencrypt-dry-run|health" >&2
    exit 2
    ;;
esac
