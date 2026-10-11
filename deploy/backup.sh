#!/usr/bin/env bash
# Nightly on the VPS (root cron): dump the database and pack uploaded files into
# /opt/lookout/backups, keeping 14 days. Eric's Mac pulls these, encrypts them and
# copies them to S3 (Life-OS scripts/lookout/pull-backup.sh), so a dead server
# loses at most a day.
set -euo pipefail
cd "${LOOKOUT_DIR:-/opt/lookout}"
umask 077
mkdir -p backups
stamp=$(date -u +%Y%m%d)
docker compose exec -T db pg_dump -U lookout -d lookout -Fc > "backups/db-$stamp.dump.part"
mv "backups/db-$stamp.dump.part" "backups/db-$stamp.dump"
tar -czf "backups/files-$stamp.tgz.part" data
mv "backups/files-$stamp.tgz.part" "backups/files-$stamp.tgz"
find backups -type f -mtime +14 -delete
