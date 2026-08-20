"use client";

import { useCallback, useEffect, useState } from "react";
import type { KcGroup, KcUser } from "@/types/keycloak";

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

export default function HrDashboardClient({ username }: { username: string }) {
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<KcUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [resetPasswordFor, setResetPasswordFor] = useState<KcUser | null>(null);
  const [manageGroupsFor, setManageGroupsFor] = useState<KcUser | null>(null);

  const loadUsers = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const data = await api<{ users: KcUser[] }>(`/api/hr/users?search=${encodeURIComponent(q)}`);
      setUsers(data.users);
    } catch (err) {
      setMsg({ text: String(err instanceof Error ? err.message : err), type: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers("");
  }, [loadUsers]);

  async function toggleEnabled(user: KcUser) {
    try {
      await api(`/api/hr/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !user.enabled }),
      });
      setMsg({ text: `${user.username} ${!user.enabled ? "enabled" : "disabled"}.`, type: "info" });
      loadUsers(search);
    } catch (err) {
      setMsg({ text: String(err instanceof Error ? err.message : err), type: "error" });
    }
  }

  async function resendOnboarding(user: KcUser) {
    try {
      await api(`/api/hr/users/${user.id}/resend-onboarding`, { method: "POST", body: "{}" });
      setMsg({ text: `Onboarding email queued for ${user.username}.`, type: "info" });
    } catch (err) {
      setMsg({ text: String(err instanceof Error ? err.message : err), type: "error" });
    }
  }

  return (
    <div className="wrap">
      <div className="bar">
        <div>
          <h1>HR User Management</h1>
          <div className="muted">Signed in as {username}</div>
        </div>
        <div className="row">
          <button className="primary" type="button" onClick={() => setShowCreate(true)}>
            + Create user
          </button>
          <a href="/api/auth/signout">Sign out</a>
        </div>
      </div>

      {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}

      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <input
            placeholder="Search by username, name, or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadUsers(search)}
            style={{ flex: 1, minWidth: 240 }}
          />
          <button type="button" onClick={() => loadUsers(search)} disabled={loading}>
            {loading ? "Searching..." : "Search"}
          </button>
        </div>

        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Name</th>
              <th>Email</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>
                  {[u.firstName, u.lastName].filter(Boolean).join(" ") || <span className="muted">-</span>}
                </td>
                <td>{u.email || <span className="muted">-</span>}</td>
                <td>
                  <span className={`pill ${u.enabled ? "on" : "off"}`}>
                    {u.enabled ? "Enabled" : "Disabled"}
                  </span>
                </td>
                <td>
                  <div className="row">
                    <button type="button" onClick={() => toggleEnabled(u)}>
                      {u.enabled ? "Disable" : "Enable"}
                    </button>
                    <button type="button" onClick={() => setResetPasswordFor(u)}>
                      Reset password
                    </button>
                    <button type="button" onClick={() => resendOnboarding(u)}>
                      Resend onboarding
                    </button>
                    <button type="button" onClick={() => setManageGroupsFor(u)}>
                      Groups
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="muted">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            loadUsers(search);
          }}
          onMessage={setMsg}
        />
      )}

      {resetPasswordFor && (
        <ResetPasswordModal
          user={resetPasswordFor}
          onClose={() => setResetPasswordFor(null)}
          onMessage={setMsg}
        />
      )}

      {manageGroupsFor && (
        <ManageGroupsModal
          user={manageGroupsFor}
          onClose={() => setManageGroupsFor(null)}
          onMessage={setMsg}
        />
      )}
    </div>
  );
}

function CreateUserModal({
  onClose,
  onCreated,
  onMessage,
}: {
  onClose: () => void;
  onCreated: () => void;
  onMessage: (m: Msg) => void;
}) {
  const [form, setForm] = useState({
    username: "",
    email: "",
    firstName: "",
    lastName: "",
    phoneNumber: "",
    sendOnboarding: true,
  });
  const [groupQuery, setGroupQuery] = useState("");
  const [groupResults, setGroupResults] = useState<KcGroup[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<KcGroup[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function searchGroups(q: string) {
    setGroupQuery(q);
    if (!q.trim()) {
      setGroupResults([]);
      return;
    }
    try {
      const data = await api<{ groups: KcGroup[] }>(`/api/hr/groups?search=${encodeURIComponent(q)}`);
      setGroupResults(data.groups);
    } catch {
      setGroupResults([]);
    }
  }

  function addGroup(g: KcGroup) {
    if (!selectedGroups.find((s) => s.id === g.id)) {
      setSelectedGroups([...selectedGroups, g]);
    }
    setGroupQuery("");
    setGroupResults([]);
  }

  async function submit() {
    if (!form.username.trim()) {
      onMessage({ text: "Username is required.", type: "error" });
      return;
    }
    setSubmitting(true);
    try {
      const result = await api<{ onboardingSent: boolean; onboardingError?: string }>("/api/hr/users", {
        method: "POST",
        body: JSON.stringify({
          username: form.username.trim(),
          email: form.email || undefined,
          firstName: form.firstName || undefined,
          lastName: form.lastName || undefined,
          phoneNumber: form.phoneNumber || undefined,
          groupPaths: selectedGroups.map((g) => g.path),
          sendOnboarding: form.sendOnboarding,
        }),
      });
      onMessage({
        text:
          `User ${form.username} created.` +
          (form.sendOnboarding
            ? result.onboardingSent
              ? " Onboarding email sent."
              : ` Onboarding email NOT sent (${result.onboardingError ?? "no email on file"}).`
            : ""),
        type: "info",
      });
      onCreated();
    } catch (err) {
      onMessage({ text: String(err instanceof Error ? err.message : err), type: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Create user</h2>
        <div className="field">
          <label>Username *</label>
          <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </div>
        <div className="field">
          <label>Email</label>
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>First name</label>
            <input
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Last name</label>
            <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>Phone number</label>
          <input
            value={form.phoneNumber}
            onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Add to existing groups</label>
          <input
            placeholder="Search groups..."
            value={groupQuery}
            onChange={(e) => searchGroups(e.target.value)}
          />
          {groupResults.length > 0 && (
            <div className="card" style={{ marginTop: 4, padding: 8 }}>
              {groupResults.map((g) => (
                <div key={g.id}>
                  <button type="button" onClick={() => addGroup(g)}>
                    + {g.path}
                  </button>
                </div>
              ))}
            </div>
          )}
          {selectedGroups.length > 0 && (
            <div className="row" style={{ marginTop: 6 }}>
              {selectedGroups.map((g) => (
                <span key={g.id} className="pill on">
                  {g.path}{" "}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setSelectedGroups(selectedGroups.filter((s) => s.id !== g.id));
                    }}
                  >
                    x
                  </a>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={form.sendOnboarding}
              onChange={(e) => setForm({ ...form, sendOnboarding: e.target.checked })}
              style={{ marginRight: 6 }}
            />
            Send onboarding email (verify email, set password, TOTP, recovery codes)
          </label>
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={submit} disabled={submitting}>
            {submitting ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordModal({
  user,
  onClose,
  onMessage,
}: {
  user: KcUser;
  onClose: () => void;
  onMessage: (m: Msg) => void;
}) {
  const [password, setPassword] = useState("");
  const [temporary, setTemporary] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    try {
      const result = await api<{ generatedPassword?: string }>(`/api/hr/users/${user.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: password || undefined, temporary, generate: !password }),
      });
      if (result.generatedPassword) {
        setGeneratedPassword(result.generatedPassword);
      } else {
        onMessage({ text: `Password set for ${user.username}.`, type: "info" });
        onClose();
      }
    } catch (err) {
      onMessage({ text: String(err instanceof Error ? err.message : err), type: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Reset password: {user.username}</h2>
        {generatedPassword ? (
          <>
            <p>Share this password with the user now - it will not be shown again:</p>
            <div className="card" style={{ fontFamily: "monospace", fontSize: 16 }}>
              {generatedPassword}
            </div>
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" className="primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label>Password (leave blank to auto-generate)</label>
              <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="field">
              <label>
                <input
                  type="checkbox"
                  checked={temporary}
                  onChange={(e) => setTemporary(e.target.checked)}
                  style={{ marginRight: 6 }}
                />
                Require change at next login (temporary)
              </label>
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={submit} disabled={submitting}>
                {submitting ? "Saving..." : "Set password"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ManageGroupsModal({
  user,
  onClose,
  onMessage,
}: {
  user: KcUser;
  onClose: () => void;
  onMessage: (m: Msg) => void;
}) {
  const [memberGroups, setMemberGroups] = useState<KcGroup[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KcGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ groups: KcGroup[] }>(`/api/hr/users/${user.id}`);
      setMemberGroups(data.groups);
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function search(q: string) {
    setQuery(q);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const data = await api<{ groups: KcGroup[] }>(`/api/hr/groups?search=${encodeURIComponent(q)}`);
    setResults(data.groups.filter((g) => !memberGroups.find((m) => m.id === g.id)));
  }

  async function add(g: KcGroup) {
    try {
      await api(`/api/hr/users/${user.id}/groups/${g.id}`, { method: "PUT" });
      setQuery("");
      setResults([]);
      load();
    } catch (err) {
      onMessage({ text: String(err instanceof Error ? err.message : err), type: "error" });
    }
  }

  async function remove(g: KcGroup) {
    try {
      await api(`/api/hr/users/${user.id}/groups/${g.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      onMessage({ text: String(err instanceof Error ? err.message : err), type: "error" });
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Groups: {user.username}</h2>
        {loading ? (
          <p className="muted">Loading...</p>
        ) : (
          <>
            <div className="field">
              <label>Current groups</label>
              {memberGroups.length === 0 && <span className="muted">Not a member of any group.</span>}
              {memberGroups.map((g) => (
                <div key={g.id} className="row" style={{ justifyContent: "space-between" }}>
                  <span>{g.path}</span>
                  <button type="button" onClick={() => remove(g)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="field">
              <label>Add to a group</label>
              <input placeholder="Search groups..." value={query} onChange={(e) => search(e.target.value)} />
              {results.map((g) => (
                <div key={g.id}>
                  <button type="button" onClick={() => add(g)}>
                    + {g.path}
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
