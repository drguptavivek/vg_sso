"use client";

import { useCallback, useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { Boxes, Loader2, Search, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SignOutButton } from "@/components/SignOutButton";
import type { KcClient, KcGroup, KcUser } from "@/types/keycloak";

interface ClientRow extends KcClient {
  appRolesGroup: KcGroup | null;
  administrators: KcUser[];
  roleGroups: KcGroup[];
  roleGroupCount: number;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    await signOut({ redirect: false });
    window.location.assign("/signin?callbackUrl=%2Fclients");
    return await new Promise<T>(() => undefined);
  }
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Request failed (${response.status})`);
  return body as T;
}

export default function ClientsDashboardClient({
  username,
  canManageAdministrators,
  isRealmAdmin,
}: {
  username: string;
  canManageAdministrators: boolean;
  isRealmAdmin: boolean;
}) {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [userQuery, setUserQuery] = useState("");
  const [results, setResults] = useState<KcUser[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ clients: ClientRow[] }>("/api/clients");
      setClients(data.clients);
      setSelectedId((current) => current || data.clients[0]?.id || "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = clients.filter((client) => {
    const value = query.trim().toLowerCase();
    return !value || client.clientId.toLowerCase().includes(value) || client.name?.toLowerCase().includes(value);
  });
  const selected = clients.find((client) => client.id === selectedId) ?? filtered[0] ?? null;

  async function searchUsers(value: string) {
    setUserQuery(value);
    if (!value.trim()) return setResults([]);
    try {
      const data = await api<{ users: KcUser[] }>(`/api/pca/users-search?search=${encodeURIComponent(value)}`);
      const existing = new Set(selected?.administrators.map((user) => user.id) ?? []);
      setResults(data.users.filter((user) => !existing.has(user.id)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function addAdministrator(user: KcUser) {
    if (!selected?.appRolesGroup?.id) return;
    try {
      await api(`/api/pca/groups/${selected.appRolesGroup.id}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: user.id }),
      });
      setUserQuery("");
      setResults([]);
      toast.success(`${user.username} is now an administrator for ${selected.clientId}.`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function removeAdministrator(user: KcUser) {
    if (!selected?.appRolesGroup?.id) return;
    try {
      await api(`/api/pca/groups/${selected.appRolesGroup.id}/members/${user.id}`, { method: "DELETE" });
      toast.success(`Removed ${user.username} from ${selected.clientId} administrators.`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Registered clients</h1>
          <p className="text-sm text-muted-foreground">Client, AppRoles and administrator audit · Signed in as {username}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild><a href="/hr">HR users</a></Button>
          <Button variant="outline" asChild><a href="/groups">Groups</a></Button>
          <Button variant="outline" asChild><a href="/audit">My activity</a></Button>
          {isRealmAdmin && <Button variant="outline" asChild><a href="/realm-roles">Realm roles</a></Button>}
          <SignOutButton />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Boxes className="h-4 w-4" /> Clients</CardTitle>
            <CardDescription>{clients.length} registered application clients</CardDescription>
          </CardHeader>
          <CardContent>
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter clients..." className="mb-3" />
            {loading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p> : (
              <div className="max-h-[650px] space-y-2 overflow-y-auto">
                {filtered.map((client) => (
                  <button key={client.id} type="button" onClick={() => setSelectedId(client.id)}
                    className={`w-full rounded-lg border p-3 text-left ${selected?.id === client.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}>
                    <span className="block truncate font-medium">{client.clientId}</span>
                    <span className="mt-1 flex gap-1">
                      <Badge variant={client.enabled === false ? "secondary" : "success"}>{client.enabled === false ? "Disabled" : "Enabled"}</Badge>
                      <Badge variant={client.appRolesGroup ? "outline" : "destructive"}>{client.appRolesGroup ? "AppRoles" : "No AppRoles"}</Badge>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{selected?.clientId ?? "Select a client"}</CardTitle>
            <CardDescription>{selected?.name || selected?.description || "Registered OpenID Connect client"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {selected && <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Summary label="Protocol" value={selected.protocol ?? "Not specified"} />
                <Summary label="AppRoles group" value={selected.appRolesGroup?.path ?? "Not present"} />
                <Summary label="Role subgroups" value={String(selected.roleGroupCount)} />
              </div>
              <section>
                <h2 className="mb-3 flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" /> Client administrators</h2>
                <div className="space-y-2">
                  {selected.administrators.map((user) => (
                    <div key={user.id} className="flex items-center justify-between rounded-lg border p-3">
                      <div><p className="font-medium">{user.username}</p><p className="text-xs text-muted-foreground">{user.email || "No email"}</p></div>
                      {canManageAdministrators && <Button size="sm" variant="outline" onClick={() => removeAdministrator(user)}>Remove</Button>}
                    </div>
                  ))}
                  {selected.administrators.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No direct client administrators.</p>}
                </div>
              </section>
              <section>
                <h2 className="mb-3 font-semibold">Application role groups</h2>
                <div className="flex flex-wrap gap-2">
                  {selected.roleGroups.map((group) => <Badge key={group.id} variant="outline">{group.name}</Badge>)}
                  {selected.roleGroups.length === 0 && <span className="text-sm text-muted-foreground">No direct application-role subgroups.</span>}
                </div>
              </section>
              {canManageAdministrators && selected.appRolesGroup && (
                <section className="space-y-2 border-t pt-4">
                  <label className="text-sm font-medium">Add an existing user as client administrator</label>
                  <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={userQuery} onChange={(event) => void searchUsers(event.target.value)} placeholder="Search username, name or email..." /></div>
                  {results.length > 0 && <div className="rounded-lg border p-1">
                    {results.map((user) => <button key={user.id} type="button" onClick={() => addAdministrator(user)} className="flex w-full items-center gap-2 rounded p-2 text-left hover:bg-muted"><Users className="h-4 w-4" /><span>{user.username}</span><span className="text-xs text-muted-foreground">{user.email}</span></button>)}
                  </div>}
                </section>
              )}
            </>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm font-medium">{value}</p></div>;
}
