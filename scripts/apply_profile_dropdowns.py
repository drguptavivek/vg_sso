#!/usr/bin/env python3
"""Render option-validated user profile attributes as dropdowns.

Keycloak's admin console shows an attribute as a dropdown only when it has the
`inputType: select` + `inputOptionsFromValidation: options` annotations. Step 2
now sets them for `employment_type` ("Type") and `designation`; this applies the
same annotations to an existing realm WITHOUT forcing step 2 (which would
overwrite manual production changes). Only those annotations are touched.

Idempotent. Use --dry-run to print the plan.
"""

import argparse
import os
import sys

import requests
import urllib3

from kc_auth import get_admin_token

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

DROPDOWN_ATTRIBUTES = ["employment_type", "designation"]
SELECT_ANNOTATIONS = {"inputType": "select", "inputOptionsFromValidation": "options"}


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--url", default=os.getenv("KC_SERVER_URL", "http://localhost:8080"))
    parser.add_argument("--realm", default=os.getenv("KC_NEW_REALM_NAME", "org-new-delhi"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    token = get_admin_token(args.url, args.realm, os.getenv("KC_NEW_REALM_ADMIN_USER"),
                            os.getenv("KC_NEW_REALM_ADMIN_PASSWORD"))
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    url = f"{args.url}/admin/realms/{args.realm}/users/profile"
    res = requests.get(url, headers=headers, verify=False, timeout=30)
    res.raise_for_status()
    profile = res.json()

    changed = []
    for attr in profile.get("attributes", []):
        if attr["name"] not in DROPDOWN_ATTRIBUTES:
            continue
        if "options" not in (attr.get("validations") or {}):
            print(f"PROFILE: {attr['name']} has no options validator; skipping", flush=True)
            continue
        annotations = attr.setdefault("annotations", {}) or {}
        attr["annotations"] = annotations
        if all(annotations.get(k) == v for k, v in SELECT_ANNOTATIONS.items()):
            print(f"PROFILE: {attr['name']} already a dropdown", flush=True)
            continue
        annotations.update(SELECT_ANNOTATIONS)
        changed.append(attr["name"])

    if not changed:
        print("PROFILE: up to date", flush=True)
        return
    if args.dry_run:
        print(f"PROFILE: [dry-run] would make dropdowns: {changed}", flush=True)
        return
    res = requests.put(url, headers=headers, json=profile, verify=False, timeout=30)
    if not res.ok:
        sys.exit(f"PROFILE: update failed: HTTP {res.status_code} {res.text[:300]}")
    print(f"PROFILE: dropdowns enabled for {changed}", flush=True)


if __name__ == "__main__":
    main()
