"use client";

import { useCallback, useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { Loader2, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SignOutButton } from "@/components/SignOutButton";
import type { KcRole, KcUser } from "@/types/keycloak";

interface RoleMembership { role: KcRole | null; members: KcUser[] }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    await signOut({ redirect: false });
    window.location.replace("/");
    return await new Promise<T>(() => undefined);
  }
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Request failed (${response.status})`);
  return body as T;
}

export default function RealmRolesDashboardClient({ username }: { username: string }) {
  const [roles, setRoles] = useState<RoleMembership[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ roles: RoleMembership[] }>("/api/realm-roles");
      setRoles(data.roles);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function remove(roleName: string, user: KcUser) {
    if (!window.confirm(`Remove ${roleName} from ${user.username}?`)) return;
    try {
      await api(`/api/realm-roles/${encodeURIComponent(roleName)}/members/${user.id}`, { method: "DELETE" });
      toast.success(`Removed ${roleName} from ${user.username}.`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function add(roleName: string, user: KcUser) {
    try {
      await api(`/api/realm-roles/${encodeURIComponent(roleName)}/members`, { method: "POST", body: JSON.stringify({ userId: user.id }) });
      toast.success(`Granted ${roleName} to ${user.username}.`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight">Privileged realm roles</h1><p className="text-sm text-muted-foreground">Realm-admin-only membership management · Signed in as {username}</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" asChild><a href="/hr">HR users</a></Button><Button variant="outline" asChild><a href="/clients">Clients</a></Button><Button variant="outline" asChild><a href="/groups">Groups</a></Button><SignOutButton /></div>
      </div>
      {loading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading role memberships...</p> : (
        <div className="grid gap-6 xl:grid-cols-3">
          {roles.map(({ role, members }) => role && <RoleCard key={role.id} role={role} members={members} onAdd={add} onRemove={remove} />)}
        </div>
      )}
    </div>
  );
}

function RoleCard({ role, members, onAdd, onRemove }: { role: KcRole; members: KcUser[]; onAdd: (role: string, user: KcUser) => Promise<void>; onRemove: (role: string, user: KcUser) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KcUser[]>([]);

  async function search(value: string) {
    setQuery(value);
    if (!value.trim()) return setResults([]);
    try {
      const data = await api<{ users: KcUser[] }>(`/api/pca/users-search?search=${encodeURIComponent(value)}`);
      const existing = new Set(members.map((user) => user.id));
      setResults(data.users.filter((user) => !existing.has(user.id)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  return <Card>
    <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" /> {role.name}</CardTitle><CardDescription>{role.description || "Privileged realm-level administrative role"}</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <Badge variant="outline">{members.length} users</Badge>
      <div className="max-h-72 space-y-2 overflow-y-auto">
        {members.map((user) => <div key={user.id} className="flex items-center justify-between gap-2 rounded-lg border p-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{user.username}</p><p className="truncate text-xs text-muted-foreground">{user.email || "No email"}</p></div><Button size="sm" variant="outline" onClick={() => onRemove(role.name, user)}>Remove</Button></div>)}
        {members.length === 0 && <p className="text-sm text-muted-foreground">No users currently hold this role.</p>}
      </div>
      <div className="space-y-2 border-t pt-4">
        <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => void search(event.target.value)} placeholder="Find a user to add..." /></div>
        {results.length > 0 && <div className="max-h-44 overflow-y-auto rounded-lg border p-1">{results.map((user) => <button key={user.id} type="button" onClick={async () => { await onAdd(role.name, user); setQuery(""); setResults([]); }} className="block w-full rounded p-2 text-left text-sm hover:bg-muted"><span className="font-medium">+ {user.username}</span><span className="ml-1 text-xs text-muted-foreground">{user.email}</span></button>)}</div>}
      </div>
    </CardContent>
  </Card>;
}
