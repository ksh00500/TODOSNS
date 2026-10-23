#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if [ "$(id -u)" != 0 ]; then
  echo 'Run this bootstrap as root in the development sandbox.' >&2
  exit 1
fi
apt-get update
apt-get install -y ca-certificates curl gnupg git xz-utils openssl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
printf '%s\n' "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
printf '%s\n' 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main' > /etc/apt/sources.list.d/nodesource.list
apt-get update
apt-get install -y nodejs docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
apt-get clean
if ! docker info >/dev/null 2>&1; then
  nohup dockerd --host=unix:///var/run/docker.sock > /var/log/mungsil-docker.log 2>&1 < /dev/null &
  for attempt in $(seq 1 45); do
    if docker info >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi
docker info --format '{{.ServerVersion}}'
docker compose version
node --version
npm --version
df -h /
