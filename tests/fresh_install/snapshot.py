"""Snapshot realm configuration from the FRESH test stack (127.0.0.1:28080 only).

Part of `make fresh-install-test`; see tests/fresh_install/run.sh.

Usage: kc_snapshot.py OUT.json   (env: KC_AUTOMATION_CLIENT_SECRET, KC_NEW_REALM_NAME)
Secrets are replaced by short hashes so changes are detectable but not printed.
"""
import hashlib, json, os, sys
import requests

BASE = "http://127.0.0.1:28080"  # fresh test stack only
R = os.environ["KC_NEW_REALM_NAME"]
tok = requests.post(f"{BASE}/realms/{R}/protocol/openid-connect/token", data={
    "grant_type": "client_credentials", "client_id": os.getenv("KC_AUTOMATION_CLIENT_ID", "sso-automation"),
    "client_secret": os.environ["KC_AUTOMATION_CLIENT_SECRET"]}, timeout=30).json()["access_token"]
H = {"Authorization": f"Bearer {tok}"}
A = f"{BASE}/admin/realms/{R}"
SECRET_KEYS = ("secret", "password", "token", "bearer", "key", "credential")


def get(path, **params):
    r = requests.get(A + path, headers=H, params=params, timeout=60)
    r.raise_for_status()
    return r.json() if r.content else None


def mask(o, key=""):
    if isinstance(o, dict):
        return {k: mask(v, k) for k, v in sorted(o.items())}
    if isinstance(o, list):
        return [mask(v, key) for v in o]
    if isinstance(o, str) and any(s in key.lower() for s in SECRET_KEYS) and o and o != "**********":
        return "sha:" + hashlib.sha256(o.encode()).hexdigest()[:10]
    return o


snap = {}
realm = get("")
for k in ("notBefore",):
    realm.pop(k, None)
snap["realm"] = realm
clients = sorted(get("/clients"), key=lambda c: c["clientId"])
for c in clients:
    if not c.get("publicClient") and c.get("clientAuthenticatorType") == "client-secret":
        try:
            c["secret"] = get(f"/clients/{c['id']}/client-secret").get("value")
        except requests.HTTPError:
            pass
    c["defaultClientScopes_"] = sorted(s["name"] for s in get(f"/clients/{c['id']}/default-client-scopes"))
snap["clients"] = clients
snap["client_scopes"] = sorted(get("/client-scopes"), key=lambda s: s["name"])
flows = sorted(get("/authentication/flows"), key=lambda f: f["alias"])
snap["flows"] = flows
snap["flow_executions"] = {f["alias"]: get(f"/authentication/flows/{requests.utils.quote(f['alias'], safe='')}/executions") for f in flows}
cfgs = {}
for alias, execs in snap["flow_executions"].items():
    for e in execs:
        if e.get("authenticationConfig"):
            cfgs[e["authenticationConfig"]] = get(f"/authentication/config/{e['authenticationConfig']}")
snap["auth_configs"] = cfgs
snap["required_actions"] = get("/authentication/required-actions")
snap["user_profile"] = get("/users/profile")
snap["events_config"] = get("/events/config")
roles = sorted(get("/roles", briefRepresentation="false"), key=lambda r: r["name"])
for r in roles:
    if r.get("composite"):
        r["composites_"] = sorted(x["name"] for x in get(f"/roles-by-id/{r['id']}/composites"))
snap["realm_roles"] = roles


def tree(groups):
    out = []
    for g in sorted(groups, key=lambda g: g["name"]):
        full = get(f"/groups/{g['id']}")
        kids = get(f"/groups/{g['id']}/children", max=1000) if g.get("subGroupCount", 0) else []
        full.pop("subGroups", None)
        full["children_"] = tree(kids)
        out.append(full)
    return out


snap["groups"] = tree(get("/groups", max=1000, briefRepresentation="false"))
ap = [c for c in clients if c["clientId"] == "admin-permissions"]
if ap:
    P = f"/clients/{ap[0]['id']}/authz/resource-server"
    pols = sorted(get(f"{P}/policy", max=-1), key=lambda p: p["name"])
    for p in pols:
        p["scopes_"] = sorted(s["name"] for s in get(f"{P}/policy/{p['id']}/scopes"))
        p["associated_"] = sorted(s["name"] for s in get(f"{P}/policy/{p['id']}/associatedPolicies"))
        p["resources_"] = sorted(s["name"] for s in get(f"{P}/policy/{p['id']}/resources"))
    snap["fgap_policies"] = pols
users = sorted(get("/users", max=5000, briefRepresentation="false"), key=lambda u: u["username"])
for u in users:
    u.pop("access", None)
    u["realm_roles_"] = sorted(x["name"] for x in get(f"/users/{u['id']}/role-mappings/realm"))
    u["groups_"] = sorted(x["path"] for x in get(f"/users/{u['id']}/groups"))
    u["credential_types_"] = sorted(x["type"] for x in get(f"/users/{u['id']}/credentials"))
snap["users"] = users
json.dump(mask(snap), open(sys.argv[1], "w"), indent=1, sort_keys=True)
print(f"snapshot: {len(clients)} clients, {len(flows)} flows, {len(users)} users, "
      f"{len(snap.get('fgap_policies', []))} fgap policies/permissions")
