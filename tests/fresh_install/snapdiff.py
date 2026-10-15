"""Structural diff of two snapshots: prints changed paths (values truncated)."""
import json, sys

a, b = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
out = []


def key_of(x):
    if isinstance(x, dict):
        for k in ("clientId", "alias", "name", "username", "providerId", "id"):
            if k in x:
                return f"{k}={x[k]}"
    return None


def walk(x, y, p):
    if type(x) != type(y):
        out.append(f"{p}: {str(x)[:80]} -> {str(y)[:80]}")
    elif isinstance(x, dict):
        for k in sorted(set(x) | set(y)):
            if k not in x:
                out.append(f"{p}.{k}: ADDED {str(y[k])[:80]}")
            elif k not in y:
                out.append(f"{p}.{k}: REMOVED")
            else:
                walk(x[k], y[k], f"{p}.{k}")
    elif isinstance(x, list):
        kx, ky = [key_of(i) for i in x], [key_of(i) for i in y]
        if all(kx) and all(ky) and len(set(kx)) == len(kx) and len(set(ky)) == len(ky):
            dx, dy = dict(zip(kx, x)), dict(zip(ky, y))
            for k in sorted(set(dx) | set(dy)):
                if k not in dx:
                    out.append(f"{p}[{k}]: ADDED")
                elif k not in dy:
                    out.append(f"{p}[{k}]: REMOVED")
                else:
                    walk(dx[k], dy[k], f"{p}[{k}]")
        elif x != y:
            if len(x) == len(y):
                for i, (u, v) in enumerate(zip(x, y)):
                    walk(u, v, f"{p}[{i}]")
            else:
                out.append(f"{p}: list len {len(x)} -> {len(y)}")
    elif x != y:
        out.append(f"{p}: {str(x)[:80]} -> {str(y)[:80]}")


walk(a, b, "")
print("\n".join(out) if out else "IDENTICAL")
print(f"-- {len(out)} difference(s)", file=sys.stderr)
