#!/usr/bin/env bash
# Uptime check for one Lookout site (#12). Run by .github/workflows/uptime.yml every few minutes.
#
# Down = /api/health failed three times, 30 seconds apart. Alerts are GitHub issues labeled
# "outage", so GitHub emails the repo owner:
#   - Down, no open outage issue: open one. Back up: comment and close it.
#   - Quiet hours (10pm to 7am New York) never open or close issues. A down check then leaves a
#     marker file (the workflow uploads it as a short-lived artifact), and the first check after
#     7am opens one "was down overnight" issue for that night.
#   - Disk (#995): /api/health says "disk":"low" once the server disk passes its alert level (85% by
#     default). That opens one "capacity" issue per site; it closes when the disk is back under. A full
#     disk lasts, so quiet hours just wait for the next daytime check.
#
# Usage: uptime-check.sh <name> <url>. Needs gh with GH_TOKEN and GH_REPO set.
set -euo pipefail

name=$1
url=$2
tries=${UPTIME_TRIES:-3}
gap=${UPTIME_GAP:-30}

body=
up() {
  local i
  for ((i = 1; i <= tries; i++)); do
    if body=$(curl -fsS -m 10 "$url" 2>&1) && [[ $body == *'"ok":true'* ]]; then return 0; fi
    echo "Try $i: ${body:0:200}"
    ((i < tries)) && sleep "$gap"
  done
  return 1
}

hour=$(TZ=America/New_York date +%-H)
quiet=false
if ((hour >= 22 || hour < 7)); then quiet=true; fi
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
title="Lookout $name is down"
issue_for() { gh issue list --label outage --state "$2" --search "in:title \"$1\"" --json number,title --jq "map(select(.title == \"$1\"))[0].number // empty"; }
open=$(issue_for "$title" open)

if up; then
  echo "$name is up"
  if [[ -n $open && $quiet == false ]]; then
    gh issue close "$open" --comment "Back up: $url answered at $now (checked by the uptime workflow)."
  fi
  is_up=true
else
  echo "$name is down"
  is_up=false
  if $quiet; then
    echo "$now" > "down-overnight-$name.txt"
  elif [[ -z $open ]]; then
    gh issue create --title "$title" --label outage --body "$(printf '%s\n' \
      "\`$url\` failed $tries health checks in a row, $gap seconds apart, at $now." \
      "" \
      "Server errors are in Admin > Errors. This issue closes itself when the site answers again." \
      "" \
      "Opened by the uptime check (#12).")"
  fi
fi

# Disk space (#995). Prod and staging share one server, so both can report the same disk.
disk_title="Lookout $name server disk is low"
if $is_up && ! $quiet; then
  disk_open=$(gh issue list --label capacity --state open --search "in:title \"$disk_title\"" --json number,title \
    --jq "map(select(.title == \"$disk_title\"))[0].number // empty")
  if [[ $body == *'"disk":"low"'* && -z $disk_open ]]; then
    gh label create capacity --color FBCA04 --description "Server running out of room (uptime check)" --force >/dev/null
    gh issue create --title "$disk_title" --label capacity --body "$(printf '%s\n' \
      "\`$url\` reports the server disk past its alert level (DISK_ALERT_PERCENT, 85% by default) at $now." \
      "" \
      "On the VPS: \`df -h /\`, \`docker system df\`, \`du -sh /opt/*\`. Weekly cleanup: deploy/disk-prune.sh." \
      "When Lookout prod moves to its own server: docs/decisions/README.md, \"Own server for prod\"." \
      "" \
      "This issue closes itself when the disk is back under. Opened by the uptime check (#995).")"
  elif [[ $body == *'"disk":"ok"'* && -n $disk_open ]]; then
    gh issue close "$disk_open" --comment "Disk back under its alert level at $now (checked by the uptime workflow)."
  fi
fi

# Morning report: down checks from last night, at most one issue per site per night.
if ! $quiet; then
  since=$(date -u -d '12 hours ago' +%Y-%m-%dT%H:%M:%SZ)
  times=$(gh api "repos/$GH_REPO/actions/artifacts?per_page=100" \
    --jq "[.artifacts[] | select(.name | startswith(\"down-overnight-$name-\")) | select(.created_at >= \"$since\") | .created_at] | sort | .[]")
  if [[ -n $times ]]; then
    night="Lookout $name was down overnight ($(TZ=America/New_York date +%Y-%m-%d))"
    if [[ -z $(issue_for "$night" all) ]]; then
      first=$(head -1 <<<"$times")
      last=$(tail -1 <<<"$times")
      n=$(wc -l <<<"$times" | tr -d ' ')
      if $is_up; then state="It is up now."; else state="It is still down; see \"$title\"."; fi
      gh issue create --title "$night" --label outage --body "$(printf '%s\n' \
        "\`$url\` failed its health check $n times during quiet hours, first at $first, last at $last (UTC). $state" \
        "" \
        "Quiet hours hold alerts from 10pm to 7am New York. Server errors from that window are in Admin > Errors." \
        "" \
        "Opened by the uptime check (#12).")"
    fi
  fi
fi
