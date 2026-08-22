#!/usr/bin/env bash
# Start the in-container Docker daemon (docker-in-docker feature).
#
# The feature registers dockerd via a container entrypoint, but the platform
# harness owns PID 1, so that entrypoint never runs — start the daemon here on
# each boot instead. `node` joins the docker group at image-build time, so once
# the daemon is up its socket is reachable with plain group perms.
#
# The host provides netfilter NAT through the nftables backend only (nft_chain_nat
# is loaded, legacy iptable_nat is not), but this image defaults `iptables` to the
# legacy binary, whose empty nat table makes dockerd's bridge setup abort. Point
# iptables at the nft backend first so the default NAT bridge comes up normally.
set -u

docker info >/dev/null 2>&1 && exit 0

command -v dockerd >/dev/null 2>&1 || {
  echo "start-dockerd: no dockerd found (is the docker-in-docker feature installed?)" >&2
  exit 0
}

sudo update-alternatives --set iptables /usr/sbin/iptables-nft >/dev/null 2>&1 || true
sudo update-alternatives --set ip6tables /usr/sbin/ip6tables-nft >/dev/null 2>&1 || true

sudo sh -c 'nohup dockerd >/tmp/dockerd.log 2>&1 &'

for _ in $(seq 1 30); do
  docker info >/dev/null 2>&1 && exit 0
  sleep 1
done

echo "start-dockerd: daemon not ready after 30s (see /tmp/dockerd.log)" >&2
exit 0
