#!/usr/bin/env bash
# Persist VPS firewall rules (#11)
# Run as root on the VPS.
#   sudo bash scripts/setup-firewall.sh
# Only ports 22 (SSH), 80 (HTTP), 443 (HTTPS) are reachable from outside.
# Docker bridge networks, loopback and established traffic pass freely.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root." >&2
  exit 1
fi

# --- Flush existing rules but keep the default policy (ACCEPT) so we
#     never drop our own SSH session during setup.
iptables -F INPUT
iptables -F FORWARD
iptables -F OUTPUT
iptables -X
iptables -t nat -F PREROUTING 2>/dev/null || true
iptables -t nat -F POSTROUTING 2>/dev/null || true

# --- Default policies
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT

# --- Loopback
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# --- Established / related
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# --- Docker bridge networks (172.x.x.x internal traffic)
iptables -A INPUT -s 172.17.0.0/16 -j ACCEPT
iptables -A INPUT -s 172.18.0.0/16 -j ACCEPT
iptables -A INPUT -s 172.19.0.0/16 -j ACCEPT
iptables -A INPUT -s 172.20.0.0/16 -j ACCEPT
iptables -A INPUT -s 172.22.0.0/16 -j ACCEPT
iptables -A INPUT -s 172.23.0.0/16 -j ACCEPT

# --- Public services
iptables -A INPUT -p tcp --dport 22 -j ACCEPT   # SSH
iptables -A INPUT -p tcp --dport 80 -j ACCEPT   # HTTP
iptables -A INPUT -p tcp --dport 443 -j ACCEPT  # HTTPS

# --- Log dropped packets (rate-limited, one per 5 seconds)
iptables -A INPUT -m limit --limit 5/min -j LOG --log-prefix "FW-DROP: " --log-level 4

# --- All other input is dropped by the default policy

echo "Firewall rules applied."

# Save persistently
if command -v netfilter-persistent &>/dev/null; then
  netfilter-persistent save
  echo "Saved via netfilter-persistent."
elif command -v iptables-save &>/dev/null; then
  mkdir -p /etc/iptables
  iptables-save > /etc/iptables/rules.v4
  echo "Saved to /etc/iptables/rules.v4."
  echo "Consider installing iptables-persistent to auto-load on boot."
fi

echo "Done."