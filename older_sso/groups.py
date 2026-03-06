from __future__ import annotations

import json
import logging
import sys
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


# =========================
# CONFIG (EDIT THESE)
# =========================
KEYCLOAK_BASE_URL = "https://sso1.vg.edu"
ADMIN_REALM = "master"
TARGET_REALM = "VG_internal"

ADMIN_USERNAME = "master_admin"
ADMIN_PASSWORD = "XXXXXXXX"

CLIENT_ID = "admin-cli"
VERIFY_TLS = True
TIMEOUT_SECONDS = 30



CLIENT_ID = "admin-cli"
VERIFY_TLS = True               # set False only if you have a self-signed cert
TIMEOUT_SECONDS = 30

# Output files
OUT_TREE_JSON = "groups_tree.json"
OUT_FLAT_JSON = "groups_flat.json"

# Debugging / robustness
LOG_LEVEL = "DEBUG"             # DEBUG / INFO / WARNING / ERROR
MAX_DEPTH = 250                  # safety limit against loops
REQUEST_RETRIES = 5             # retry count for transient failures
BACKOFF_FACTOR = 0.6            # retry backoff factor
RATE_LIMIT_SLEEP_SEC = 0.0      # set e.g. 0.05 if you want to be gentle
PAGE_SIZE = 100                 # Keycloak list endpoints are paginated; fetch all pages
# =========================


def setup_logging() -> logging.Logger:
    logger = logging.getLogger("kc_export")
    logger.setLevel(getattr(logging, LOG_LEVEL.upper(), logging.DEBUG))

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(logger.level)
    fmt = logging.Formatter(
        "%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    handler.setFormatter(fmt)
    logger.handlers.clear()
    logger.addHandler(handler)
    logger.propagate = False
    return logger


LOGGER = setup_logging()


def build_session() -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=REQUEST_RETRIES,
        connect=REQUEST_RETRIES,
        read=REQUEST_RETRIES,
        status=REQUEST_RETRIES,
        backoff_factor=BACKOFF_FACTOR,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET", "POST"]),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    s.mount("http://", adapter)
    s.mount("https://", adapter)
    return s


SESSION = build_session()


def normalize_attributes(attrs: Any) -> Dict[str, List[str]]:
    """
    Keycloak stores group attributes as dict[str, list[str]].
    Normalize missing/None/non-list to that format.
    """
    if not attrs or not isinstance(attrs, dict):
        return {}
    out: Dict[str, List[str]] = {}
    for k, v in attrs.items():
        if v is None:
            out[k] = []
        elif isinstance(v, list):
            out[k] = [str(x) for x in v]
        else:
            out[k] = [str(v)]
    return out


@dataclass
class KCConfig:
    base_url: str
    admin_realm: str
    target_realm: str
    username: str
    password: str
    client_id: str
    verify_tls: bool
    timeout: int


CFG = KCConfig(
    base_url=KEYCLOAK_BASE_URL,
    admin_realm=ADMIN_REALM,
    target_realm=TARGET_REALM,
    username=ADMIN_USERNAME,
    password=ADMIN_PASSWORD,
    client_id=CLIENT_ID,
    verify_tls=VERIFY_TLS,
    timeout=TIMEOUT_SECONDS,
)


def http_post(url: str, data: Dict[str, str]) -> requests.Response:
    LOGGER.debug(f"POST {url} (data keys={list(data.keys())})")
    r = SESSION.post(url, data=data, verify=CFG.verify_tls, timeout=CFG.timeout)
    LOGGER.debug(f"-> {r.status_code} ({len(r.text)} bytes)")
    return r


def http_get(url: str, token: str, params: Optional[Dict[str, Any]] = None) -> requests.Response:
    headers = {"Authorization": f"Bearer {token}"}
    LOGGER.debug(f"GET  {url} (params={params})")
    r = SESSION.get(url, headers=headers, params=params, verify=CFG.verify_tls, timeout=CFG.timeout)
    LOGGER.debug(f"-> {r.status_code} ({len(r.text)} bytes)")
    return r


def get_admin_token() -> str:
    token_url = f"{CFG.base_url.rstrip('/')}/realms/{CFG.admin_realm}/protocol/openid-connect/token"
    data = {
        "grant_type": "password",
        "client_id": CFG.client_id,
        "username": CFG.username,
        "password": CFG.password,
    }
    r = http_post(token_url, data=data)
    if r.status_code != 200:
        # Avoid logging secrets; token endpoint returns useful error details
        raise RuntimeError(f"Token request failed ({r.status_code}): {r.text}")

    payload = r.json()
    token = payload.get("access_token")
    if not token:
        raise RuntimeError(f"No access_token in token response: {payload}")
    LOGGER.info("Authenticated successfully (admin token acquired).")
    return token


def kc_get(path: str, token: str, params: Optional[Dict[str, Any]] = None) -> Any:
    url = f"{CFG.base_url.rstrip('/')}{path}"
    r = http_get(url, token, params=params)

    # Keycloak sometimes returns HTML errors via reverse proxies; include snippet for debugging
    if r.status_code != 200:
        snippet = r.text[:500].replace("\n", "\\n")
        raise RuntimeError(f"GET {path} failed ({r.status_code}). Body(head)= {snippet}")

    try:
        return r.json()
    except Exception as e:
        snippet = r.text[:500].replace("\n", "\\n")
        raise RuntimeError(f"Non-JSON response for {path}: {e}. Body(head)= {snippet}") from e
    finally:
        if RATE_LIMIT_SLEEP_SEC > 0:
            time.sleep(RATE_LIMIT_SLEEP_SEC)


def list_top_level_groups(token: str) -> List[Dict[str, Any]]:
    groups: List[Dict[str, Any]] = []
    first = 0
    while True:
        page = kc_get(
            f"/admin/realms/{CFG.target_realm}/groups",
            token,
            params={"first": first, "max": PAGE_SIZE},
        )
        if not isinstance(page, list):
            raise RuntimeError(f"Unexpected /groups response type: {type(page)}")
        groups.extend(page)
        if len(page) < PAGE_SIZE:
            break
        first += PAGE_SIZE
    LOGGER.info(f"Top-level groups found: {len(groups)}")
    return groups


def get_group_details(token: str, group_id: str) -> Dict[str, Any]:
    return kc_get(f"/admin/realms/{CFG.target_realm}/groups/{group_id}", token)


def list_group_children(token: str, group_id: str) -> List[Dict[str, Any]]:
    children: List[Dict[str, Any]] = []
    first = 0
    while True:
        page = kc_get(
            f"/admin/realms/{CFG.target_realm}/groups/{group_id}/children",
            token,
            params={"first": first, "max": PAGE_SIZE},
        )
        if not isinstance(page, list):
            raise RuntimeError(f"Unexpected children response type for {group_id}: {type(page)}")
        children.extend(page)
        if len(page) < PAGE_SIZE:
            break
        first += PAGE_SIZE
    return children


def build_group_tree(
    token: str,
    group_id: str,
    depth: int = 0,
    visited: Optional[set[str]] = None,
) -> Dict[str, Any]:
    if visited is None:
        visited = set()

    if depth > MAX_DEPTH:
        raise RuntimeError(f"Max depth exceeded at group {group_id}. Check for cycles or unusually deep nesting.")

    if group_id in visited:
        # Shouldn't happen in proper Keycloak trees, but keep safe
        LOGGER.warning(f"Cycle detected: already visited group id {group_id}. Skipping further recursion.")
        return {"name": None, "path": None, "attributes": {}, "subGroups": []}

    visited.add(group_id)

    details = get_group_details(token, group_id)
    name = details.get("name", "")
    path = details.get("path")  # Keycloak provides canonical path here (best source)
    attrs = normalize_attributes(details.get("attributes"))

    LOGGER.debug(f"{'  '*depth}Group: {path or name} (id={group_id}) attrs={len(attrs)}")

    node: Dict[str, Any] = {
        "name": name,
        "path": path or f"/{name}",
        "attributes": attrs,
        "subGroups": [],
    }

    children = list_group_children(token, group_id)
    if children:
        LOGGER.debug(f"{'  '*depth}Children of {node['path']}: {len(children)}")
    else:
        LOGGER.debug(f"{'  '*depth}Children of {node['path']}: 0")

    # Deterministic ordering by name
    children_sorted = sorted(children, key=lambda x: (x.get("name") or "").lower())

    for ch in children_sorted:
        ch_id = ch.get("id")
        if not ch_id:
            LOGGER.warning(f"{'  '*depth}Child missing id under {node['path']}: {ch}")
            continue
        node["subGroups"].append(build_group_tree(token, ch_id, depth=depth + 1, visited=visited))

    return node


def flatten_tree(tree: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []

    def parent_of(path: str) -> Optional[str]:
        parts = path.strip("/").split("/")
        if len(parts) <= 1:
            return None
        return "/" + "/".join(parts[:-1])

    def walk(node: Dict[str, Any]) -> None:
        path = node.get("path") or ""
        out.append(
            {
                "path": path,
                "name": node.get("name") or "",
                "parentPath": parent_of(path) if path else None,
                "attributes": node.get("attributes") or {},
            }
        )
        for sg in node.get("subGroups", []) or []:
            walk(sg)

    for top in sorted(tree, key=lambda x: (x.get("path") or "").lower()):
        walk(top)

    return out


def main() -> int:
    try:
        LOGGER.info(f"Keycloak base URL: {CFG.base_url}")
        LOGGER.info(f"Target realm: {CFG.target_realm}")
        token = get_admin_token()

        top = list_top_level_groups(token)
        top_sorted = sorted(top, key=lambda x: (x.get("name") or "").lower())

        tree: List[Dict[str, Any]] = []
        missing_id = 0
        for g in top_sorted:
            gid = g.get("id")
            if not gid:
                missing_id += 1
                LOGGER.warning(f"Top-level group missing id: {g}")
                continue
            tree.append(build_group_tree(token, gid, depth=0, visited=set()))

        if missing_id:
            LOGGER.warning(f"Top-level groups missing id: {missing_id}")

        flat = flatten_tree(tree)

        with open(OUT_TREE_JSON, "w", encoding="utf-8") as f:
            json.dump(tree, f, indent=2, ensure_ascii=False)
        with open(OUT_FLAT_JSON, "w", encoding="utf-8") as f:
            json.dump(flat, f, indent=2, ensure_ascii=False)

        LOGGER.info(f"Wrote: {OUT_TREE_JSON} (top-level: {len(tree)})")
        LOGGER.info(f"Wrote: {OUT_FLAT_JSON} (total groups incl. subgroups: {len(flat)})")
        return 0

    except Exception as e:
        LOGGER.exception(f"Export failed: {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
