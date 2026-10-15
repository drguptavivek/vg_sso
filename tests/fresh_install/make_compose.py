"""Build an isolated fresh-install compose file from the real (resolved) config.

Everything that could touch production is renamed or redirected:
project/volumes/network/images/containers -> fresh-*, no prod ports, keycloak
logs + step9 exports -> scratch, repo binds read-only. Refuses to write if any
production identifier survives.
"""
import json, sys, os

src, out, scratch = sys.argv[1], sys.argv[2], sys.argv[3]
c = json.load(open(src))
P = "vg_sso_fresh"
c["name"] = P
c["volumes"] = {k: {"name": f"{P}_{k}"} for k in c["volumes"]}
c["volumes"]["fresh_exports"] = {"name": f"{P}_exports"}
c["networks"] = {"default": {"name": f"{P}_default"}}
os.makedirs(f"{scratch}/fresh-logs", exist_ok=True)

for name in list(c["services"]):
    s = c["services"][name]
    if name == "keycloak-maintenance":
        del c["services"][name]
        continue
    s["container_name"] = "fresh-" + s.get("container_name", name)
    if s.get("build"):
        s["image"] = f"{P}-{name}:test"
    s.pop("ports", None)
    vols = []
    for v in s.get("volumes", []):
        if v.get("type") == "bind":
            if v["target"] == "/var/log/keycloak":
                v = {**v, "source": f"{scratch}/fresh-logs"}
            else:
                v = {**v, "read_only": True}
        vols.append(v)
    if name == "step9-init":
        vols.append({"type": "volume", "source": "fresh_exports", "target": "/fresh-exports"})
        env = s.setdefault("environment", {})
        env["AUDIT_EXPORT_OUTPUT_DIR"] = "/fresh-exports/audit"
        env["AUDIT_EXPORT_STATE_FILE"] = "/fresh-exports/audit/state/watermark.json"
    if vols:
        s["volumes"] = vols
    for k, val in list((s.get("environment") or {}).items()):
        if isinstance(val, str) and val.rstrip("/").endswith("logs/keycloak"):
            s["environment"][k] = f"{scratch}/fresh-logs"
    if name == "keycloak":
        s["ports"] = [{"target": 8080, "published": "28080", "host_ip": "127.0.0.1", "protocol": "tcp"},
                      {"target": 9000, "published": "29000", "host_ip": "127.0.0.1", "protocol": "tcp"}]

text = json.dumps(c, indent=1)
bad = [t for t in ('"vg_sso_postgres_data"', '"vg_sso_keycloak_data"', '"vg_sso_default"', '"vg-keycloak"', '"vg-postgres"',
                   '/logs/keycloak"', '"/workspace/exports')
       if t in text]
rw_repo = [v["source"] for s in c["services"].values() for v in s.get("volumes", [])
           if v.get("type") == "bind" and not v.get("read_only") and not v["source"].startswith(os.path.abspath(scratch))]
if bad or rw_repo:
    sys.exit(f"REFUSING: production identifiers remain: {bad} writable repo binds: {rw_repo}")
fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    f.write(text)
print(f"fresh compose written ({len(c['services'])} services), isolation checks passed")
