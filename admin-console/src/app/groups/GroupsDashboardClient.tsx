"use client";

import { useCallback, useEffect, useState } from "react";
import type { GroupTreeNode, KcUser } from "@/types/keycloak";

interface Msg {
  text: string;
  type: "info" | "error";
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data.error === "string" ? data.error : JSON.stringify(data.error ?? data);
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return data as T;
}

export default function GroupsDashboardClient({ username }: { username: string }) {
  const [roots, setRoots] = useState<GroupTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [membersFor, setMembersFor] = useState<GroupTreeNode | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ roots: GroupTreeNode[] }>("/api/pca/my-groups");
      setRoots(data.roots);
    } catch (err) {
      setMsg({ text: String(err instanceof Error ? err.message : err), type: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createChild(parent: GroupTreeNode) {
    const name = window.prompt(`New subgroup name under "${parent.name}":`);
    if (!name || !name.trim()) return;
    try {
      await api(`/api/pca/groups/${parent.id}/children`, {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      setMsg({ text: `Created "${name.trim()}".`, type: "info" });
      load();
    } catch (err) {
      setMsg({ text: String(err instanceof Error ? err.message : err), type: "error" });
    }
  }

  async function rename(node: GroupTreeNode) {
    const name = window.prompt(`Rename "${node.name}" to:`, node.name);
    if (!name || !name.trim() || name.trim() === node.name) return;
    try {
      await api(`/api/pca/groups/${node.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim() }),
      });
      setMsg({ text: `Renamed to "${name.trim()}".`, type: "info" });
      load();
    } catch (err) {
      setMsg({ text: String(err instanceof Error ? err.message : err), type: "error" });
    }
  }

  async function remove(node: GroupTreeNode) {
    if (!window.confirm(`Delete "${node.name}" and all of its subgroups? This cannot be undone.`)) return;
    try {
      await api(`/api/pca/groups/${node.id}`, { method: "DELETE" });
      setMsg({ text: `Deleted "${node.name}".`, type: "info" });
      load();
    } catch (err) {
      setMsg({ text: String(err instanceof Error ? err.message : err), type: "error" });
    }
  }

  return (
    <div className="wrap">
      <div className="bar">
        <div>
          <h1>Client App Group Management</h1>
          <div className="muted">Signed in as {username}</div>
        </div>
        <a href="/api/auth/signout">Sign out</a>
      </div>

      {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

      <div className="card">
        <p className="muted">
          You can create, rename, and delete subgroups, and manage membership, anywhere inside the groups
          you administer below. Root groups themselves cannot be renamed or deleted.
        </p>
        {loading && <p className="muted">Loading...</p>}
        {!loading && roots.length === 0 && (
          <p className="muted">
            You are not a delegated administrator of any client application group yet. Ask a realm admin
            or a client-manager to add you.
          </p>
        )}
        {roots.map((root) => (
          <GroupNode
            key={root.id}
            node={root}
            isRoot
            onCreateChild={createChild}
            onRename={rename}
            onDelete={remove}
            onMembers={setMembersFor}
          />
        ))}
      </div>

      {membersFor && (
        <MembersModal group={membersFor} onClose={() => setMembersFor(null)} onMessage={setMsg} />
      )}
    </div>
  );
}

function GroupNode({
  node,
  isRoot,
  onCreateChild,
  onRename,
  onDelete,
  onMembers,
}: {
  node: GroupTreeNode;
  isRoot?: boolean;
  onCreateChild: (node: GroupTreeNode) => void;
  onRename: (node: GroupTreeNode) => void;
  onDelete: (node: GroupTreeNode) => void;
  onMembers: (node: GroupTreeNode) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <div className="tree-node">
        {node.children.length > 0 ? (
          <button type="button" onClick={() => setExpanded(!expanded)} style={{ padding: "2px 6px" }}>
            {expanded ? "-" : "+"}
          </button>
        ) : (
          <span style={{ width: 24, display: "inline-block" }} />
        )}
        <strong>{node.name}</strong>
        {isRoot && <span className="pill on">app root</span>}
        <span className="muted">{node.path}</span>
        <div className="row">
          <button type="button" onClick={() => onCreateChild(node)}>
            + Subgroup
          </button>
          <button type="button" onClick={() => onMembers(node)}>
            Members
          </button>
          {!isRoot && (
            <>
              <button type="button" onClick={() => onRename(node)}>
                Rename
              </button>
              <button type="button" className="danger" onClick={() => onDelete(node)}>
                Delete
              </button>
            </>
          )}
        </div>
      </div>
      {expanded && node.children.length > 0 && (
        <ul className="tree">
          {node.children.map((child) => (
            <li key={child.id}>
              <GroupNode
                node={child}
                onCreateChild={onCreateChild}
                onRename={onRename}
                onDelete={onDelete}
                onMembers={onMembers}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MembersModal({
  group,
  onClose,
  onMessage,
}: {
  group: GroupTreeNode;
  onClose: () => void;
  onMessage: (m: Msg) => void;
}) {
  const [members, setMembers] = useState<KcUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KcUser[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ members: KcUser[] }>(`/api/pca/groups/${group.id}/members`);
      setMembers(data.members);
    } finally {
      setLoading(false);
    }
  }, [group.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function search(q: string) {
    setQuery(q);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const data = await api<{ users: KcUser[] }>(`/api/pca/users-search?search=${encodeURIComponent(q)}`);
    setResults(data.users.filter((u) => !members.find((m) => m.id === u.id)));
  }

  async function add(u: KcUser) {
    try {
      await api(`/api/pca/groups/${group.id}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: u.id }),
      });
      setQuery("");
      setResults([]);
      load();
    } catch (err) {
      onMessage({ text: String(err instanceof Error ? err.message : err), type: "error" });
    }
  }

  async function remove(u: KcUser) {
    try {
      await api(`/api/pca/groups/${group.id}/members/${u.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      onMessage({ text: String(err instanceof Error ? err.message : err), type: "error" });
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Members: {group.name}</h2>
        {loading ? (
          <p className="muted">Loading...</p>
        ) : (
          <>
            <div className="field">
              {members.length === 0 && <span className="muted">No members yet.</span>}
              {members.map((u) => (
                <div key={u.id} className="row" style={{ justifyContent: "space-between" }}>
                  <span>
                    {u.username} {u.email ? `(${u.email})` : ""}
                  </span>
                  <button type="button" onClick={() => remove(u)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="field">
              <label>Add existing user</label>
              <input
                placeholder="Search by username, name, or email..."
                value={query}
                onChange={(e) => search(e.target.value)}
              />
              {results.map((u) => (
                <div key={u.id}>
                  <button type="button" onClick={() => add(u)}>
                    + {u.username} {u.email ? `(${u.email})` : ""}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
