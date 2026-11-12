#!/usr/bin/env bash
# One-shot VPS setup for CI-based staging deploy (#18). Run as root.
# Usage: bash <(curl -fsS https://raw.githubusercontent.com/ericseandevlin/lookout/main/deploy/vps-setup.sh)
set -euo pipefail

echo "=== Lookout CI deploy setup (#18) ==="

# Create registry login (uses the same GitHub token the system already has)
echo "Setting up ghcr.io registry login..."
if [ ! -f /root/.config/lookout-ghcr/config.json ]; then
  mkdir -p /root/.config/lookout-ghcr
  chmod 700 /root/.config/lookout-ghcr
  # Use the GitHub CLI token from the claude user
  GH_TOKEN=$(sudo -u claude gh auth token 2>/dev/null || echo "")
  if [ -z "$GH_TOKEN" ]; then
    echo "Could not get GitHub token from claude user."
    echo "Generate a classic token (read:packages) and paste it:"
    read -rs token
    echo
    echo "$token" | docker login ghcr.io -u ericseandevlin --password-stdin
  else
    echo "$GH_TOKEN" | DOCKER_CONFIG=/root/.config/lookout-ghcr docker login ghcr.io -u ericseandevlin --password-stdin
  fi
fi

# Run the installer from the repo
echo "Running install-pull-deploy.sh..."
bash <(curl -fsS https://raw.githubusercontent.com/ericseandevlin/lookout/main/deploy/install-pull-deploy.sh) stage

echo "=== Done ==="
echo "Staging now follows ghcr.io/ericseandevlin/lookout:stage."
echo "To deploy: push to release/stage (auto from main via CI)."
