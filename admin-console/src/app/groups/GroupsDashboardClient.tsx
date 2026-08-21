"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Boxes, ChevronDown, ChevronRight, Folder, FolderTree, Landmark, Loader2, Plus, Search, UserRound, Users } from "lucide-react";
import type { GroupTreeNode, KcGroup, KcUser } from "@/types/keycloak";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/SignOutButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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

interface RealmAuditRow {
  group: string;
  memberships: string[];
}

interface ApplicationAuditRow {
  application: string;
  delegatedAdmin: boolean;
  roles: string[];
}

function buildRealmAuditRows(groups: KcGroup[]): RealmAuditRow[] {
  const rows = new Map<string, Set<string>>();
  groups
    .filter((group) => !group.path.startsWith("/AppRoles/"))
    .forEach((group) => {
      const segments = group.path.split("/").filter(Boolean);
      if (segments.length === 0) return;
      const values = rows.get(segments[0]) ?? new Set<string>();
      values.add(segments.length === 1 ? "Direct member" : segments.slice(1).join(" > "));
      rows.set(segments[0], values);
    });
  return Array.from(rows, ([group, memberships]) => ({
    group,
    memberships: Array.from(memberships).sort(),
  })).sort((a, b) => a.group.localeCompare(b.group));
}

function buildApplicationAuditRows(groups: KcGroup[]): ApplicationAuditRow[] {
  const rows = new Map<string, { delegatedAdmin: boolean; roles: Set<string> }>();
  groups
    .filter((group) => group.path.startsWith("/AppRoles/"))
    .forEach((group) => {
      const segments = group.path.split("/").filter(Boolean);
      if (segments.length < 2) return;
      const application = segments[1];
      const row = rows.get(application) ?? { delegatedAdmin: false, roles: new Set<string>() };
      if (segments.length === 2) row.delegatedAdmin = true;
      if (segments.length > 2) row.roles.add(segments.slice(2).join(" > "));
      rows.set(application, row);
    });
  return Array.from(rows, ([application, row]) => ({
    application,
    delegatedAdmin: row.delegatedAdmin,
    roles: Array.from(row.roles).sort(),
  })).sort((a, b) => a.application.localeCompare(b.application));
}

export default function GroupsDashboardClient({
  username,
  showHrLink = false,
  isRealmAdmin = false,
}: {
  username: string;
  showHrLink?: boolean;
  isRealmAdmin?: boolean;
}) {
  const [roots, setRoots] = useState<GroupTreeNode[]>([]);
  const [realmGroups, setRealmGroups] = useState<GroupTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [membersFor, setMembersFor] = useState<GroupTreeNode | null>(null);
  const [auditQuery, setAuditQuery] = useState("");
  const [auditResults, setAuditResults] = useState<KcUser[]>([]);
  const [auditUser, setAuditUser] = useState<KcUser | null>(null);
  const [auditGroups, setAuditGroups] = useState<KcGroup[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditSearched, setAuditSearched] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ roots: GroupTreeNode[]; realmGroups?: GroupTreeNode[] }>("/api/pca/my-groups");
      setRoots(data.roots);
      setRealmGroups(data.realmGroups ?? []);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const savedSearch = url.searchParams.get("auditSearch");
    const savedUserId = url.searchParams.get("auditUser");
    if (!savedSearch) return;

    setAuditQuery(savedSearch);
    setAuditLoading(true);
    void api<{ users: KcUser[] }>(
      "/api/pca/users-search?search=" + encodeURIComponent(savedSearch),
    )
      .then(async (data) => {
        setAuditResults(data.users);
        setAuditSearched(true);
        if (savedUserId) {
          const detail = await api<{ user: KcUser; groups: KcGroup[] }>(
            "/api/hr/users/" + savedUserId,
          );
          setAuditUser(detail.user);
          setAuditGroups(detail.groups);
        }
      })
      .catch((err) => toast.error(errMsg(err)))
      .finally(() => setAuditLoading(false));
  }, []);

  async function searchAuditUsers() {
    if (!auditQuery.trim()) {
      setAuditResults([]);
      setAuditSearched(false);
      return;
    }
    setAuditLoading(true);
    setAuditResults([]);
    setAuditUser(null);
    setAuditGroups([]);
    try {
      const data = await api<{ users: KcUser[] }>(
        "/api/pca/users-search?search=" + encodeURIComponent(auditQuery),
      );
      setAuditResults(data.users);
      setAuditSearched(true);
      const url = new URL(window.location.href);
      url.searchParams.set("auditSearch", auditQuery.trim());
      url.searchParams.delete("auditUser");
      window.history.replaceState(null, "", url);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setAuditLoading(false);
    }
  }

  function clearAudit() {
    setAuditQuery("");
    setAuditSearched(false);
    setAuditResults([]);
    setAuditUser(null);
    setAuditGroups([]);
    const url = new URL(window.location.href);
    url.searchParams.delete("auditSearch");
    url.searchParams.delete("auditUser");
    window.history.replaceState(null, "", url);
  }

  async function auditSelectedUser(user: KcUser) {
    setAuditLoading(true);
    setAuditUser(user);
    const url = new URL(window.location.href);
    url.searchParams.set("auditSearch", auditQuery.trim());
    url.searchParams.set("auditUser", user.id);
    window.history.replaceState(null, "", url);
    try {
      const data = await api<{ user: KcUser; groups: KcGroup[] }>("/api/hr/users/" + user.id);
      setAuditUser(data.user);
      setAuditGroups(data.groups);
    } catch (err) {
      setAuditGroups([]);
      toast.error(errMsg(err));
    } finally {
      setAuditLoading(false);
    }
  }

  async function createChild(parent: GroupTreeNode) {
    const name = window.prompt(`New application role name under "${parent.name}":`);
    if (!name || !name.trim()) return;
    try {
      await api(`/api/pca/groups/${parent.id}/children`, {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      toast.success("Created application role \"" + name.trim() + "\".");
      load();
    } catch (err) {
      toast.error(errMsg(err));
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
      toast.success(`Renamed to "${name.trim()}".`);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  async function remove(node: GroupTreeNode) {
    if (!window.confirm(`Delete "${node.name}" and all of its subgroups? This cannot be undone.`)) return;
    try {
      await api(`/api/pca/groups/${node.id}`, { method: "DELETE" });
      toast.success(`Deleted "${node.name}".`);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  const realmAuditRows = buildRealmAuditRows(auditGroups);
  const applicationAuditRows = buildApplicationAuditRows(auditGroups);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Client App Group Management</h1>
          <p className="text-sm text-muted-foreground">Signed in as {username}</p>
        </div>
        <div className="flex items-center gap-3">
          {showHrLink && (
            <Button variant="outline" asChild>
              <a href="/hr">HR users</a>
            </Button>
          )}
          <SignOutButton />
        </div>
      </div>

      {isRealmAdmin && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <UserRound className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">Audit a user’s groups</CardTitle>
            </div>
            <CardDescription>Search for a user and review all direct group memberships in an expanded hierarchy.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={auditQuery}
                onChange={(event) => setAuditQuery(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && searchAuditUsers()}
                placeholder="Search username, name, or email"
                className="sm:max-w-md"
              />
              <Button variant="outline" onClick={searchAuditUsers} disabled={auditLoading}>
                {auditLoading ? <Loader2 className="animate-spin" /> : <Search />} Search
              </Button>
              <Button type="button" variant="ghost" onClick={clearAudit}>Clear</Button>
            </div>

            {auditSearched && !auditLoading && auditResults.length === 0 && (
              <p className="text-sm text-muted-foreground">No users matched that search.</p>
            )}

            {auditResults.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {auditResults.length} match{auditResults.length === 1 ? "" : "es"} - select a user
                </p>
                <div className="grid gap-2 rounded-lg border p-2 sm:grid-cols-2 lg:grid-cols-3">
                {auditResults.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => auditSelectedUser(user)}
                    className="rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="block font-medium">{user.username}</span>
                    {(user.firstName || user.lastName) && (
                      <span className="block text-xs">{[user.firstName, user.lastName].filter(Boolean).join(" ")}</span>
                    )}
                    {user.email && <span className="block truncate text-xs text-muted-foreground">{user.email}</span>}
                  </button>
                ))}
              </div>
                </div>
            )}

            {auditUser && (
              <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
                <div>
                  <p className="font-semibold">{auditUser.username}</p>
                  {auditUser.email && <p className="text-sm text-muted-foreground">{auditUser.email}</p>}
                </div>
                {auditGroups.length === 0 && !auditLoading ? (
                  <p className="text-sm text-muted-foreground">This user has no direct group memberships.</p>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    <RealmAuditTable rows={realmAuditRows} />
                    <ApplicationAuditTable rows={applicationAuditRows} />
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,2fr)] lg:items-start">
        <Card className="lg:sticky lg:top-6">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Landmark className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">Realm-wide groups</CardTitle>
            </div>
            <CardDescription>Top-level groups shared across the realm, separate from application roles.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {!isRealmAdmin && (
              <p className="text-sm text-muted-foreground">Visible to realm administrators.</p>
            )}
            {isRealmAdmin && realmGroups.length === 0 && !loading && (
              <p className="text-sm text-muted-foreground">No realm-wide groups found.</p>
            )}
            {realmGroups.map((group) => (
              <div key={group.id} className="rounded-lg border bg-muted/20 p-3">
                <div className="flex items-start gap-2">
                  <FolderTree className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="font-medium leading-none">{group.name}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{group.path}</p>
                  </div>
                  <Badge variant="secondary" className="ml-auto shrink-0">
                    {group.subGroupCount ?? 0} subgroups
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Boxes className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">Application Specific Groups</CardTitle>
            </div>
            <CardDescription>
              Each application is a protected root card. Its application roles appear as nested child cards with direct-member counts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
              </div>
            )}
            {!loading && roots.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
                <FolderTree className="h-8 w-8 opacity-50" />
                <p>{isRealmAdmin ? "No application groups found under AppRoles." : "You do not administer any application groups yet."}</p>
                {!isRealmAdmin && <p className="text-sm">Ask a realm admin or a client-manager to add you.</p>}
              </div>
            )}
            <div className="space-y-4">
              {roots.map((root) => (
                <GroupNode
                  key={root.id}
                  node={root}
                  depth={0}
                  isRoot
                  onCreateChild={createChild}
                  onRename={rename}
                  onDelete={remove}
                  onMembers={setMembersFor}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <MembersDialog
        group={membersFor}
        onOpenChange={(open) => {
          if (!open) {
            setMembersFor(null);
            load();
          }
        }}
      />
    </div>
  );
}

function RealmAuditTable({ rows }: { rows: RealmAuditRow[] }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Realm-wide memberships</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">None</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.group} className="grid gap-2 rounded-lg border bg-background p-3 sm:grid-cols-[minmax(130px,0.35fr)_1fr]">
              <p className="font-medium">{row.group}</p>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">&gt;</span>
                {row.memberships.map((membership) => (
                  <Badge key={membership} variant="secondary">{membership}</Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ApplicationAuditTable({ rows }: { rows: ApplicationAuditRow[] }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Application-specific memberships</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">None</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.application} className="space-y-2 rounded-lg border bg-background p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{row.application}</p>
                {row.delegatedAdmin && <Badge>Delegated admin</Badge>}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Roles:</span>
                {row.roles.length === 0 ? (
                  <span className="text-muted-foreground">None</span>
                ) : (
                  row.roles.map((role) => <Badge key={role} variant="outline">{role}</Badge>)
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupNode({
  node,
  depth,
  isRoot,
  onCreateChild,
  onRename,
  onDelete,
  onMembers,
}: {
  node: GroupTreeNode;
  depth: number;
  isRoot?: boolean;
  onCreateChild: (node: GroupTreeNode) => void;
  onRename: (node: GroupTreeNode) => void;
  onDelete: (node: GroupTreeNode) => void;
  onMembers: (node: GroupTreeNode) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={(event) => { event.stopPropagation(); onMembers(node); }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onMembers(node);
        }
      }}
      className={
        isRoot
          ? "cursor-pointer overflow-hidden border-primary/20 shadow-sm transition-colors hover:border-primary/40"
          : "cursor-pointer shadow-none transition-colors hover:border-primary/40"
      }
    >
      <div className={isRoot ? "bg-muted/30 p-4" : "p-3"}>
        <div className="flex flex-wrap items-start gap-2">
          {node.children.length > 0 ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setExpanded(!expanded);
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-background hover:bg-accent"
              aria-label={expanded ? "Collapse " + node.name : "Expand " + node.name}
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center">
              {isRoot ? <Boxes className="h-4 w-4" /> : <Folder className="h-4 w-4 text-muted-foreground" />}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={isRoot ? "font-semibold" : "font-medium"}>{node.name}</span>
              <Badge variant={isRoot ? "default" : "outline"}>
                {isRoot ? "Application" : "Application role"}
              </Badge>
              <Badge variant="secondary">{node.memberCount ?? 0} direct members</Badge>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">{node.path}</p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); onCreateChild(node); }}>
              <Plus /> Add role
            </Button>
            <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); onMembers(node); }}>
              <Users /> Members
            </Button>
            {!isRoot && (
              <>
                <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); onRename(node); }}>
                  Rename
                </Button>
                <Button size="sm" variant="destructive" onClick={(event) => { event.stopPropagation(); onDelete(node); }}>
                  Delete
                </Button>
              </>
            )}
          </div>
        </div>

        {expanded && node.children.length > 0 && (
          <div className={depth === 0 ? "mt-4 space-y-3 border-l-2 border-primary/15 pl-4" : "mt-3 space-y-3 border-l pl-3"}>
            {node.children.map((child) => (
              <GroupNode
                key={child.id}
                node={child}
                depth={depth + 1}
                onCreateChild={onCreateChild}
                onRename={onRename}
                onDelete={onDelete}
                onMembers={onMembers}
              />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function MembersDialog({
  group,
  onOpenChange,
}: {
  group: GroupTreeNode | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [members, setMembers] = useState<KcUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KcUser[]>([]);

  const load = useCallback(async () => {
    if (!group) return;
    setLoading(true);
    try {
      const data = await api<{ members: KcUser[] }>(`/api/pca/groups/${group.id}/members`);
      setMembers(data.members);
    } finally {
      setLoading(false);
    }
  }, [group]);

  useEffect(() => {
    if (group) {
      setQuery("");
      setResults([]);
      load();
    }
  }, [group, load]);

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
    if (!group) return;
    try {
      await api(`/api/pca/groups/${group.id}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: u.id }),
      });
      setQuery("");
      setResults([]);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  async function remove(u: KcUser) {
    if (!group) return;
    try {
      await api(`/api/pca/groups/${group.id}/members/${u.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  return (
    <Dialog open={!!group} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Members: {group?.name}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              {members.length === 0 && <p className="text-sm text-muted-foreground">No members yet.</p>}
              {members.map((u) => (
                <div key={u.id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                  <span>
                    {u.username} {u.email ? `(${u.email})` : ""}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => remove(u)}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label>Add existing user</Label>
              <Input
                placeholder="Search by username, name, or email..."
                value={query}
                onChange={(e) => search(e.target.value)}
              />
              {results.length > 0 && (
                <div className="rounded-md border p-2 text-sm">
                  {results.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => add(u)}
                      className="block w-full rounded px-2 py-1 text-left hover:bg-accent"
                    >
                      + {u.username} {u.email ? `(${u.email})` : ""}
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
