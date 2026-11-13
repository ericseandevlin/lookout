#!/usr/bin/env bash
# Weekly disk cleanup on the VPS (#995), root cron, installed by pull-deploy.sh on each staging deploy.
# The server is shared with other tools, so this only removes what no one can be using:
#   - dangling images (old Lookout tags replaced by a newer pull, failed builds)
#   - Docker build cache older than a week
# It never touches stopped containers, volumes, tagged images or other tools' files. Backups keep 14 days
# on their own (backup.sh).
# Each run writes what uses the disk to $LOOKOUT_DISK_REPORT (readable by agents) so the next cleanup or the
# "own server" decision (docs/decisions/README.md) starts from numbers, not guesses.
set -euo pipefail
report=${LOOKOUT_DISK_REPORT:-/opt/lookout-staging/DISK.txt}
pct() { df --output=pcent / | tail -1 | tr -dc 0-9; }

before=$(pct)
docker image prune -f >/dev/null
docker builder prune -f --filter until=168h >/dev/null
after=$(pct)

{
  echo "$(date -u +%FT%TZ) disk / ${before}% before cleanup, ${after}% after (alert at 85%)"
  echo
  df -h /
  echo
  docker system df
  echo
  du -xsh /opt/*/ /var/log /var/lib/docker /home/*/ 2>/dev/null | sort -rh | head -15
} > "$report.part"
chmod 644 "$report.part"
mv "$report.part" "$report"
echo "$(date -u +%FT%TZ) disk ${before}% -> ${after}%"
