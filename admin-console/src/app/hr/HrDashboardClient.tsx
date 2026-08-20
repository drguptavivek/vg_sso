"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Search, UserRound } from "lucide-react";
import type { KcGroup, KcUser } from "@/types/keycloak";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

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

function errMsg(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export default function HrDashboardClient({ username }: { username: string }) {
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<KcUser[]>([]);
  const [loading, setLoading] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [resetPasswordFor, setResetPasswordFor] = useState<KcUser | null>(null);
  const [manageGroupsFor, setManageGroupsFor] = useState<KcUser | null>(null);

  const loadUsers = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const data = await api<{ users: KcUser[] }>(`/api/hr/users?search=${encodeURIComponent(q)}`);
      setUsers(data.users);
    } catch (err) {
      toast.error(errMsg(err));
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
      toast.success(`${user.username} ${!user.enabled ? "enabled" : "disabled"}.`);
      loadUsers(search);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  async function resendOnboarding(user: KcUser) {
    try {
      await api(`/api/hr/users/${user.id}/resend-onboarding`, { method: "POST", body: "{}" });
      toast.success(`Onboarding email queued for ${user.username}.`);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">HR User Management</h1>
          <p className="text-sm text-muted-foreground">Signed in as {username}</p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => setShowCreate(true)}>
            <Plus /> Create user
          </Button>
          <Button variant="ghost" asChild>
            <a href="/api/auth/signout">Sign out</a>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Users</CardTitle>
          <CardDescription>Search, then manage credentials, status, or group membership.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Search by username, name, or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadUsers(search)}
              className="max-w-sm"
            />
            <Button variant="outline" onClick={() => loadUsers(search)} disabled={loading}>
              {loading ? <Loader2 className="animate-spin" /> : <Search />}
              Search
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.username}</TableCell>
                    <TableCell>
                      {[u.firstName, u.lastName].filter(Boolean).join(" ") || (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>{u.email || <span className="text-muted-foreground">-</span>}</TableCell>
                    <TableCell>
                      <Badge variant={u.enabled ? "success" : "secondary"}>
                        {u.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => toggleEnabled(u)}>
                          {u.enabled ? "Disable" : "Enable"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setResetPasswordFor(u)}>
                          Reset password
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => resendOnboarding(u)}>
                          Resend onboarding
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setManageGroupsFor(u)}>
                          Groups
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {users.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <UserRound className="h-8 w-8 opacity-50" />
                        No users found.
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <CreateUserDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={() => {
          setShowCreate(false);
          loadUsers(search);
        }}
      />

      <ResetPasswordDialog user={resetPasswordFor} onOpenChange={(open) => !open && setResetPasswordFor(null)} />

      <ManageGroupsDialog user={manageGroupsFor} onOpenChange={(open) => !open && setManageGroupsFor(null)} />
    </div>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
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

  useEffect(() => {
    if (!open) {
      setForm({ username: "", email: "", firstName: "", lastName: "", phoneNumber: "", sendOnboarding: true });
      setGroupQuery("");
      setGroupResults([]);
      setSelectedGroups([]);
    }
  }, [open]);

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
      toast.error("Username is required.");
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
      toast.success(
        `User ${form.username} created.` +
          (form.sendOnboarding
            ? result.onboardingSent
              ? " Onboarding email sent."
              : ` Onboarding email NOT sent (${result.onboardingError ?? "no email on file"}).`
            : ""),
      );
      onCreated();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>Add a new SSO account and optionally assign existing groups.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="username">Username *</Label>
            <Input id="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">First name</Label>
              <Input
                id="firstName"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Last name</Label>
              <Input
                id="lastName"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone number</Label>
            <Input
              id="phone"
              value={form.phoneNumber}
              onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Add to existing groups</Label>
            <Input placeholder="Search groups..." value={groupQuery} onChange={(e) => searchGroups(e.target.value)} />
            {groupResults.length > 0 && (
              <div className="rounded-md border p-2 text-sm">
                {groupResults.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => addGroup(g)}
                    className="block w-full rounded px-2 py-1 text-left hover:bg-accent"
                  >
                    + {g.path}
                  </button>
                ))}
              </div>
            )}
            {selectedGroups.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {selectedGroups.map((g) => (
                  <Badge key={g.id} variant="secondary" className="gap-1">
                    {g.path}
                    <button
                      type="button"
                      className="ml-1 opacity-70 hover:opacity-100"
                      onClick={() => setSelectedGroups(selectedGroups.filter((s) => s.id !== g.id))}
                    >
                      x
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="sendOnboarding"
              checked={form.sendOnboarding}
              onCheckedChange={(checked) => setForm({ ...form, sendOnboarding: checked === true })}
            />
            <Label htmlFor="sendOnboarding" className="font-normal">
              Send onboarding email (verify email, set password, TOTP, recovery codes)
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  user,
  onOpenChange,
}: {
  user: KcUser | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  const [temporary, setTemporary] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setPassword("");
      setTemporary(true);
      setGeneratedPassword(null);
    }
  }, [user]);

  async function submit() {
    if (!user) return;
    setSubmitting(true);
    try {
      const result = await api<{ generatedPassword?: string }>(`/api/hr/users/${user.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: password || undefined, temporary, generate: !password }),
      });
      if (result.generatedPassword) {
        setGeneratedPassword(result.generatedPassword);
      } else {
        toast.success(`Password set for ${user.username}.`);
        onOpenChange(false);
      }
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password: {user?.username}</DialogTitle>
        </DialogHeader>
        {generatedPassword ? (
          <>
            <p className="text-sm">Share this password with the user now - it will not be shown again:</p>
            <div className="rounded-md border bg-muted p-3 font-mono text-base">{generatedPassword}</div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">Password (leave blank to auto-generate)</Label>
                <Input id="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="temporary" checked={temporary} onCheckedChange={(c) => setTemporary(c === true)} />
                <Label htmlFor="temporary" className="font-normal">
                  Require change at next login (temporary)
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={submitting}>
                {submitting && <Loader2 className="animate-spin" />}
                Set password
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ManageGroupsDialog({
  user,
  onOpenChange,
}: {
  user: KcUser | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [memberGroups, setMemberGroups] = useState<KcGroup[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KcGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await api<{ groups: KcGroup[] }>(`/api/hr/users/${user.id}`);
      setMemberGroups(data.groups);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      setQuery("");
      setResults([]);
      load();
    }
  }, [user, load]);

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
    if (!user) return;
    try {
      await api(`/api/hr/users/${user.id}/groups/${g.id}`, { method: "PUT" });
      setQuery("");
      setResults([]);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  async function remove(g: KcGroup) {
    if (!user) return;
    try {
      await api(`/api/hr/users/${user.id}/groups/${g.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Groups: {user?.username}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Current groups</Label>
              {memberGroups.length === 0 && (
                <p className="text-sm text-muted-foreground">Not a member of any group.</p>
              )}
              {memberGroups.map((g) => (
                <div key={g.id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                  <span>{g.path}</span>
                  <Button size="sm" variant="ghost" onClick={() => remove(g)}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label>Add to a group</Label>
              <Input placeholder="Search groups..." value={query} onChange={(e) => search(e.target.value)} />
              {results.length > 0 && (
                <div className="rounded-md border p-2 text-sm">
                  {results.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => add(g)}
                      className="block w-full rounded px-2 py-1 text-left hover:bg-accent"
                    >
                      + {g.path}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
