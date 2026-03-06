#!/usr/bin/env bash
# kcadm.sh — Host-side wrapper that delegates to the running Keycloak container.
# Usage: ./kcadm.sh <kcadm args...>
# Example: ./kcadm.sh config credentials --server http://localhost:8080 --realm master --user admin --password admin
exec docker exec vg-keycloak /opt/keycloak/bin/kcadm.sh "$@"
