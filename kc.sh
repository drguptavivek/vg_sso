#!/usr/bin/env bash
# kc.sh — Host-side wrapper that delegates to the running Keycloak container.
# Usage: ./kc.sh <kc args...>
# Example: ./kc.sh show-config
exec docker exec vg-keycloak /opt/keycloak/bin/kc.sh "$@"
