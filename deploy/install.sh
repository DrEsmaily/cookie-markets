#!/usr/bin/env bash
set -euo pipefail

repository="${COOKIE_MARKETS_REPOSITORY:-https://github.com/DrEsmaily/cookie-markets.git}"
install_directory="${COOKIE_MARKETS_INSTALL_DIR:-/opt/cookie-markets}"
bind_address="${COOKIE_MARKETS_BIND:-127.0.0.1}"
listen_port="${COOKIE_MARKETS_PORT:-3100}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root or with sudo." >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  apt-get update
  apt-get install -y git ca-certificates
fi

if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y docker.io docker-compose-v2
  systemctl enable --now docker
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required." >&2
  exit 1
fi

if [[ -d "${install_directory}/.git" ]]; then
  git -C "${install_directory}" pull --ff-only
else
  mkdir -p "$(dirname "${install_directory}")"
  git clone --depth 1 "${repository}" "${install_directory}"
fi

cat > "${install_directory}/.env.docker" <<EOF
COOKIE_MARKETS_BIND=${bind_address}
COOKIE_MARKETS_PORT=${listen_port}
COOKIE_CHAIN_RPC=${COOKIE_CHAIN_RPC:-https://rpc.cookiescan.io}
EOF

docker compose --env-file "${install_directory}/.env.docker" -f "${install_directory}/compose.yaml" up -d --build web

echo "CookieMarkets is running at http://${bind_address}:${listen_port}"
echo "Persistent data is stored in the cookie-markets_cookie-markets-data Docker volume."
echo "For wallet use, place an HTTPS reverse proxy in front of this local port."
