"""Shared admin token for automation scripts.

Prefers the sso-automation service account (client credentials in
KC_NEW_REALM_NAME) when KC_AUTOMATION_CLIENT_SECRET is set. Human admin accounts
may have 2FA, which a password grant cannot satisfy, so username/password is
only a fallback (fresh installs before step 1 creates the client).
"""

import os
import sys

import requests


def _service_account():
    secret = os.getenv("KC_AUTOMATION_CLIENT_SECRET", "").strip()
    realm = os.getenv("KC_NEW_REALM_NAME", "").strip()
    client = os.getenv("KC_AUTOMATION_CLIENT_ID", "sso-automation").strip() or "sso-automation"
    return (realm, client, secret) if secret and realm else None


def service_account_token(keycloak_url, verify=False, timeout=30):
    """Service account access token, or None if not configured or not usable yet."""
    sa = _service_account()
    if sa is None:
        return None
    realm, client, secret = sa
    try:
        res = requests.post(
            f"{keycloak_url}/realms/{realm}/protocol/openid-connect/token",
            data={"grant_type": "client_credentials", "client_id": client, "client_secret": secret},
            verify=verify, timeout=timeout,
        )
    except requests.exceptions.RequestException:
        return None
    return res.json()["access_token"] if res.ok else None


def get_admin_token(keycloak_url, realm, user, password, verify=False, timeout=30):
    token = service_account_token(keycloak_url, verify=verify, timeout=timeout)
    if token:
        return token
    sa = _service_account()

    if not user or not password:
        raise RuntimeError("no working admin credentials (service account login failed and no fallback user)")
    res = requests.post(
        f"{keycloak_url}/realms/{realm}/protocol/openid-connect/token",
        data={"client_id": "admin-cli", "grant_type": "password", "username": user, "password": password},
        verify=verify, timeout=timeout,
    )
    res.raise_for_status()
    if sa is not None:
        print(f"WARN: service account '{sa[1]}' login failed in realm '{sa[0]}'; "
              f"used fallback user '{user}'.", file=sys.stderr, flush=True)
    return res.json()["access_token"]
