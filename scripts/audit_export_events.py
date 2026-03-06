#!/usr/bin/env python3
import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
from pathlib import Path
from typing import Any, Dict, List

import requests


def iso_day(value: str) -> dt.date:
    return dt.date.fromisoformat(value)


def day_str(d: dt.date) -> str:
    return d.isoformat()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


class KeycloakAdminClient:
    def __init__(self, base_url: str, realm: str, user: str, password: str, timeout: int = 30):
        self.base_url = base_url.rstrip("/")
        self.realm = realm
        self.user = user
        self.password = password
        self.timeout = timeout
        self.session = requests.Session()
        self._token = None

    def authenticate(self) -> None:
        url = f"{self.base_url}/realms/{self.realm}/protocol/openid-connect/token"
        data = {
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": self.user,
            "password": self.password,
        }
        r = self.session.post(url, data=data, timeout=self.timeout)
        r.raise_for_status()
        payload = r.json()
        self._token = payload["access_token"]
        self.session.headers.update({"Authorization": f"Bearer {self._token}"})

    def _get_paged(self, path: str, date_from: str, date_to: str, batch_size: int) -> List[Dict[str, Any]]:
        all_items: List[Dict[str, Any]] = []
        first = 0
        while True:
            params = {
                "dateFrom": date_from,
                "dateTo": date_to,
                "first": first,
                "max": batch_size,
            }
            url = f"{self.base_url}/admin/realms/{self.realm}/{path}"
            r = self.session.get(url, params=params, timeout=self.timeout)
            r.raise_for_status()
            chunk = r.json()
            if not chunk:
                break
            if not isinstance(chunk, list):
                raise RuntimeError(f"Unexpected response type for {path}: {type(chunk)}")
            all_items.extend(chunk)
            if len(chunk) < batch_size:
                break
            first += batch_size
        return all_items

    def get_user_events_for_day(self, day: dt.date, batch_size: int) -> List[Dict[str, Any]]:
        ds = day_str(day)
        return self._get_paged("events", ds, ds, batch_size)

    def get_admin_events_for_day(self, day: dt.date, batch_size: int) -> List[Dict[str, Any]]:
        ds = day_str(day)
        return self._get_paged("admin-events", ds, ds, batch_size)


def load_watermark(path: Path) -> dt.date | None:
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    val = data.get("last_exported_day")
    if not val:
        return None
    return iso_day(val)


def save_watermark(path: Path, d: dt.date) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"last_exported_day": day_str(d)}, indent=2) + "\n")


def write_jsonl_gz(path: Path, rows: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, separators=(",", ":"), ensure_ascii=False))
            f.write("\n")


def daterange(start: dt.date, end: dt.date):
    cur = start
    while cur <= end:
        yield cur
        cur += dt.timedelta(days=1)


def main() -> int:
    parser = argparse.ArgumentParser(description="Export Keycloak audit/admin events to compressed JSONL archives.")
    parser.add_argument("--url", default=os.environ.get("KC_SERVER_URL", "http://keycloak:8080"))
    parser.add_argument("--realm", default=os.environ.get("KC_NEW_REALM_NAME", "org-new-delhi"))
    parser.add_argument("--user", default=os.environ.get("KC_NEW_REALM_ADMIN_USER", ""))
    parser.add_argument("--password", default=os.environ.get("KC_NEW_REALM_ADMIN_PASSWORD", ""))
    parser.add_argument("--output-dir", default=os.environ.get("AUDIT_EXPORT_OUTPUT_DIR", "/workspace/exports/audit"))
    parser.add_argument("--state-file", default=os.environ.get("AUDIT_EXPORT_STATE_FILE", "/workspace/exports/audit/state/watermark.json"))
    parser.add_argument("--start-date", default=os.environ.get("AUDIT_EXPORT_START_DATE", ""), help="YYYY-MM-DD; overrides watermark-based start")
    parser.add_argument("--end-date", default=os.environ.get("AUDIT_EXPORT_END_DATE", ""), help="YYYY-MM-DD; default yesterday")
    parser.add_argument("--batch-size", type=int, default=int(os.environ.get("AUDIT_EXPORT_BATCH_SIZE", "500")))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.user or not args.password:
        raise SystemExit("KC_NEW_REALM_ADMIN_USER and KC_NEW_REALM_ADMIN_PASSWORD are required")

    output_dir = Path(args.output_dir)
    state_file = Path(args.state_file)

    if args.end_date:
        end_date = iso_day(args.end_date)
    else:
        end_date = dt.date.today() - dt.timedelta(days=1)

    if args.start_date:
        start_date = iso_day(args.start_date)
    else:
        wm = load_watermark(state_file)
        if wm is None:
            start_date = end_date
        else:
            start_date = wm + dt.timedelta(days=1)

    if start_date > end_date:
        print(f"AUDIT-EXPORT: nothing to export (start={start_date} end={end_date})")
        return 0

    client = KeycloakAdminClient(args.url, args.realm, args.user, args.password)
    client.authenticate()

    exported_days: List[str] = []
    for day in daterange(start_date, end_date):
        user_events = client.get_user_events_for_day(day, args.batch_size)
        admin_events = client.get_admin_events_for_day(day, args.batch_size)

        day_dir = output_dir / args.realm / day.strftime("%Y") / day.strftime("%m") / day.strftime("%d")
        user_file = day_dir / f"user-events-{day_str(day)}.jsonl.gz"
        admin_file = day_dir / f"admin-events-{day_str(day)}.jsonl.gz"
        manifest_file = day_dir / "manifest.json"

        print(
            f"AUDIT-EXPORT: day={day_str(day)} user_events={len(user_events)} admin_events={len(admin_events)}"
        )

        if args.dry_run:
            continue

        write_jsonl_gz(user_file, user_events)
        write_jsonl_gz(admin_file, admin_events)

        manifest = {
            "realm": args.realm,
            "day": day_str(day),
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "files": {
                user_file.name: {
                    "count": len(user_events),
                    "sha256": sha256_file(user_file),
                },
                admin_file.name: {
                    "count": len(admin_events),
                    "sha256": sha256_file(admin_file),
                },
            },
        }
        manifest_file.write_text(json.dumps(manifest, indent=2) + "\n")

        save_watermark(state_file, day)
        exported_days.append(day_str(day))

    if args.dry_run:
        print("AUDIT-EXPORT: dry-run complete; no files written")
    else:
        print(f"AUDIT-EXPORT: complete; exported_days={exported_days}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
