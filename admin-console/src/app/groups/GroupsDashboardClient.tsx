"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { Boxes, ChevronDown, ChevronRight, Folder, FolderTree, Landmark, Loader2, Plus, Search, UserRound, Users } from "lucide-react";
import type { GroupTreeNode, KcGroup, KcUser } from "@/types/keycloak";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/SignOutButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    await signOut({ redirect: false });
    window.location.assign("/signin?callbackUrl=%2Fgroups");
    return await new Promise<T>(() => undefined);
  }
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
  isUserManager = false,
  canManageApplicationRoles = false,
}: {
  username: string;
  showHrLink?: boolean;
  isRealmAdmin?: boolean;
  isUserManager?: boolean;
  canManageApplicationRoles?: boolean;
}) {
  const hasRealmWideAccess = isRealmAdmin || isUserManager;
  const [activeView, setActiveView] = useState<"institute" | "applications" | "audit">(
    hasRealmWideAccess ? "institute" : "applications",
  );
  const [roots, setRoots] = useState<GroupTreeNode[]>([]);
  const [realmGroups, setRealmGroups] = useState<GroupTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
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
    const view = new URL(window.location.href).searchParams.get("view");
    if (view === "applications" || (hasRealmWideAccess && (view === "institute" || view === "audit"))) {
      setActiveView(view);
    }
  }, [hasRealmWideAccess]);

  useEffect(() => {
    if (!hasRealmWideAccess) return;
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
  }, [hasRealmWideAccess]);

  function changeView(view: "institute" | "applications" | "audit") {
    if (!hasRealmWideAccess && view !== "applications") return;
    setActiveView(view);
    const url = new URL(window.location.href);
    url.searchParams.set("view", view);
    window.history.replaceState(null, "", url);
  }

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
    <div className="mx-auto w-full max-w-[1920px] space-y-6 p-4 sm:p-6">
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

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
        <Card className="lg:sticky lg:top-6">
          <CardHeader>
            <CardTitle className="text-base">Group management</CardTitle>
            <CardDescription>Select a workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            <nav className="space-y-2" aria-label="Group management sections">
              {hasRealmWideAccess && (
                <WorkspaceLink
                  active={activeView === "institute"}
                  href="?view=institute"
                  icon={<Landmark className="h-4 w-4" />}
                  onClick={() => changeView("institute")}
                >
                  Browse Institute Wide Groups
                </WorkspaceLink>
              )}
              <WorkspaceLink
                active={activeView === "applications"}
                href="?view=applications"
                icon={<Boxes className="h-4 w-4" />}
                onClick={() => changeView("applications")}
              >
                Application Specific Roles
              </WorkspaceLink>
              {hasRealmWideAccess && (
                <WorkspaceLink
                  active={activeView === "audit"}
                  href="?view=audit"
                  icon={<UserRound className="h-4 w-4" />}
                  onClick={() => changeView("audit")}
                >
                  Audit a User’s Groups
                </WorkspaceLink>
              )}
            </nav>
            {!hasRealmWideAccess && (
              <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
                Only applications delegated to you are visible.
              </p>
            )}
          </CardContent>
        </Card>

        <main className="min-w-0 space-y-6">
      {hasRealmWideAccess && activeView === "audit" && (
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

      <div className="space-y-6">
        {hasRealmWideAccess && activeView === "institute" && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Landmark className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">Institute Wide Groups</CardTitle>
            </div>
            <CardDescription>Browse parent groups, recursively nested child groups, and direct members side by side.</CardDescription>
          </CardHeader>
          <CardContent>
            {realmGroups.length === 0 && !loading && (
              <p className="text-sm text-muted-foreground">No realm-wide groups found.</p>
            )}
            <ThreeColumnGroupBrowser
              parents={realmGroups}
              kind="institute"
              canManageRoles={false}
              onCreateChild={createChild}
              onRename={rename}
              onDelete={remove}
              onMembershipChanged={load}
            />
          </CardContent>
        </Card>
        )}

        {activeView === "applications" && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Boxes className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">Application Specific Roles</CardTitle>
            </div>
            <CardDescription>
              Browse applications, recursively nested application roles, and direct members side by side.
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
                <p>{hasRealmWideAccess ? "No application groups found under AppRoles." : "You do not administer any application groups yet."}</p>
                {!hasRealmWideAccess && <p className="text-sm">Ask a realm admin or a client-manager to add you.</p>}
              </div>
            )}
            <ThreeColumnGroupBrowser
              parents={roots}
              kind="application"
              canManageRoles={canManageApplicationRoles}
              onCreateChild={createChild}
              onRename={rename}
              onDelete={remove}
              onMembershipChanged={load}
            />
          </CardContent>
        </Card>
        )}
      </div>
        </main>
      </div>

    </div>
  );
}

function findGroup(nodes: GroupTreeNode[], id: string): GroupTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const match = findGroup(node.children, id);
    if (match) return match;
  }
  return null;
}

function filterGroupTree(nodes: GroupTreeNode[], query: string): GroupTreeNode[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return nodes;
  return nodes.flatMap((node) => {
    const children = filterGroupTree(node.children, query);
    const matches =
      node.name.toLowerCase().includes(normalized) ||
      node.path.toLowerCase().includes(normalized);
    return matches || children.length > 0 ? [{ ...node, children }] : [];
  });
}

function ThreeColumnGroupBrowser({
  parents,
  kind,
  canManageRoles,
  onCreateChild,
  onRename,
  onDelete,
  onMembershipChanged,
}: {
  parents: GroupTreeNode[];
  kind: "institute" | "application";
  canManageRoles: boolean;
  onCreateChild: (node: GroupTreeNode) => void;
  onRename: (node: GroupTreeNode) => void;
  onDelete: (node: GroupTreeNode) => void;
  onMembershipChanged: () => void;
}) {
  const [parentQuery, setParentQuery] = useState("");
  const [childQuery, setChildQuery] = useState("");
  const [selectedParentId, setSelectedParentId] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");

  const selectedParent =
    parents.find((parent) => parent.id === selectedParentId) ?? parents[0] ?? null;
  const selectedGroup = selectedParent
    ? findGroup([selectedParent], selectedGroupId) ?? selectedParent
    : null;
  const filteredParents = parents.filter((parent) => {
    const query = parentQuery.trim().toLowerCase();
    return !query || parent.name.toLowerCase().includes(query) || parent.path.toLowerCase().includes(query);
  });
  const filteredChildren = selectedParent
    ? filterGroupTree(selectedParent.children, childQuery)
    : [];

  useEffect(() => {
    if (!selectedParent && parents[0]) {
      setSelectedParentId(parents[0].id);
      setSelectedGroupId(parents[0].id);
    }
  }, [parents, selectedParent]);

  function selectParent(parent: GroupTreeNode) {
    setSelectedParentId(parent.id);
    setSelectedGroupId(parent.id);
    setChildQuery("");
  }

  return (
    <div className="grid min-h-[560px] overflow-hidden rounded-xl border xl:grid-cols-[minmax(220px,0.75fr)_minmax(300px,1.1fr)_minmax(340px,1.2fr)]">
      <section className="border-b bg-slate-50/90 p-4 dark:bg-slate-950/30 xl:border-b-0 xl:border-r">
        <div className="mb-3">
          <p className="text-sm font-semibold">
            {kind === "application" ? "Applications" : "Parent groups"}
          </p>
          <p className="text-xs text-muted-foreground">Select a top-level group.</p>
        </div>
        <Input
          value={parentQuery}
          onChange={(event) => setParentQuery(event.target.value)}
          placeholder={kind === "application" ? "Filter applications..." : "Filter parent groups..."}
          className="mb-3 bg-background"
        />
        <div className="max-h-[460px] space-y-1 overflow-y-auto pr-1">
          {filteredParents.map((parent) => (
            <button
              key={parent.id}
              type="button"
              onClick={() => selectParent(parent)}
              className={
                "w-full rounded-lg border px-3 py-2.5 text-left transition-colors " +
                (selectedParent?.id === parent.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background hover:bg-accent")
              }
            >
              <span className="block truncate text-sm font-medium">{parent.name}</span>
              <span className={"mt-1 block text-xs " + (selectedParent?.id === parent.id ? "text-primary-foreground/75" : "text-muted-foreground")}>
                {parent.children.length} child groups · {parent.memberCount ?? 0} direct members
              </span>
            </button>
          ))}
          {filteredParents.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No parent groups match.</p>
          )}
        </div>
      </section>

      <section className="border-b bg-slate-100/70 p-4 dark:bg-slate-900/30 xl:border-b-0 xl:border-r">
        <div className="mb-3 flex min-h-10 items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">
              {kind === "application" ? "Application roles" : "Child groups"}
            </p>
            <p className="text-xs text-muted-foreground">
              {selectedParent ? `Nested under ${selectedParent.name}` : "Select a parent group."}
            </p>
          </div>
          {kind === "application" && canManageRoles && selectedParent && (
            <Button size="sm" variant="outline" onClick={() => onCreateChild(selectedParent)}>
              <Plus /> Add role
            </Button>
          )}
        </div>
        <Input
          value={childQuery}
          onChange={(event) => setChildQuery(event.target.value)}
          placeholder={kind === "application" ? "Filter roles at any level..." : "Filter child groups at any level..."}
          className="mb-3 bg-background"
          disabled={!selectedParent}
        />
        {selectedParent && (
          <button
            type="button"
            onClick={() => setSelectedGroupId(selectedParent.id)}
            className={
              "mb-2 w-full rounded-lg border px-3 py-2 text-left text-sm " +
              (selectedGroup?.id === selectedParent.id ? "border-primary bg-primary/10" : "bg-background hover:bg-accent")
            }
          >
            <span className="font-medium">{selectedParent.name}</span>
            <span className="ml-2 text-xs text-muted-foreground">(parent group members)</span>
          </button>
        )}
        <div className="max-h-[400px] space-y-1 overflow-y-auto pr-1">
          {filteredChildren.map((node) => (
            <BrowserTreeNode
              key={node.id}
              node={node}
              selectedId={selectedGroup?.id ?? ""}
              kind={kind}
              canManageRoles={canManageRoles}
              forceExpanded={Boolean(childQuery.trim())}
              onSelect={setSelectedGroupId}
              onCreateChild={onCreateChild}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
          {selectedParent && filteredChildren.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {childQuery ? "No nested groups match." : "This parent has no child groups."}
            </p>
          )}
        </div>
      </section>

      <MembersColumn group={selectedGroup} onChanged={onMembershipChanged} />
    </div>
  );
}

function BrowserTreeNode({
  node,
  selectedId,
  kind,
  canManageRoles,
  forceExpanded,
  onSelect,
  onCreateChild,
  onRename,
  onDelete,
  depth = 0,
}: {
  node: GroupTreeNode;
  selectedId: string;
  kind: "institute" | "application";
  canManageRoles: boolean;
  forceExpanded: boolean;
  onSelect: (id: string) => void;
  onCreateChild: (node: GroupTreeNode) => void;
  onRename: (node: GroupTreeNode) => void;
  onDelete: (node: GroupTreeNode) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const isExpanded = forceExpanded || expanded;
  return (
    <div>
      <div
        className={
          "flex items-center gap-1 rounded-lg border px-2 py-2 " +
          (selectedId === node.id ? "border-primary bg-primary/10" : "bg-background hover:bg-accent")
        }
        style={{ marginLeft: Math.min(depth, 6) * 12 }}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            className="rounded p-1 hover:bg-background"
            onClick={() => setExpanded(!expanded)}
            aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
          >
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <Folder className="mx-1 h-3.5 w-3.5 text-muted-foreground" />
        )}
        <button type="button" onClick={() => onSelect(node.id)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-medium">{node.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {node.memberCount ?? 0} direct members · {node.path}
          </span>
        </button>
        {kind === "application" && canManageRoles && (
          <div className="flex shrink-0 gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7" title="Add nested role" onClick={() => onCreateChild(node)}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onRename(node)}>Rename</Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" onClick={() => onDelete(node)}>Delete</Button>
          </div>
        )}
      </div>
      {isExpanded && node.children.length > 0 && (
        <div className="mt-1 space-y-1 border-l border-slate-300 dark:border-slate-700" style={{ marginLeft: Math.min(depth, 6) * 12 + 10 }}>
          {node.children.map((child) => (
            <BrowserTreeNode
              key={child.id}
              node={child}
              selectedId={selectedId}
              kind={kind}
              canManageRoles={canManageRoles}
              forceExpanded={forceExpanded}
              onSelect={onSelect}
              onCreateChild={onCreateChild}
              onRename={onRename}
              onDelete={onDelete}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkspaceLink({
  active,
  href,
  icon,
  onClick,
  children,
}: {
  active: boolean;
  href: string;
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onClick();
      }}
      className={
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors " +
        (active ? "bg-primary text-primary-foreground" : "hover:bg-accent")
      }
    >
      {icon}
      <span>{children}</span>
    </a>
  );
}

function InstituteGroupNode({
  node,
  onMembers,
}: {
  node: GroupTreeNode;
  onMembers: (node: GroupTreeNode) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {node.children.length > 0 ? (
          <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        ) : (
          <FolderTree className="h-4 w-4 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium">{node.name}</p>
          <p className="truncate text-xs text-muted-foreground">{node.path}</p>
        </div>
        <Badge variant="secondary">{node.memberCount ?? 0} direct members</Badge>
        <Badge variant="outline">{node.children.length} subgroups</Badge>
        <Button size="sm" variant="outline" onClick={() => onMembers(node)}>
          <Users /> Members
        </Button>
      </div>
      {expanded && node.children.length > 0 && (
        <div className="mt-3 space-y-2 border-l pl-4">
          {node.children.map((child) => (
            <InstituteGroupNode key={child.id} node={child} onMembers={onMembers} />
          ))}
        </div>
      )}
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
  canManageRoles,
  onCreateChild,
  onRename,
  onDelete,
  onMembers,
}: {
  node: GroupTreeNode;
  depth: number;
  isRoot?: boolean;
  canManageRoles: boolean;
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
            {canManageRoles && (
              <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); onCreateChild(node); }}>
                <Plus /> Add role
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); onMembers(node); }}>
              <Users /> Members
            </Button>
            {canManageRoles && !isRoot && (
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
                canManageRoles={canManageRoles}
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

function MembersColumn({
  group,
  onChanged,
}: {
  group: GroupTreeNode | null;
  onChanged: () => void;
}) {
  const [members, setMembers] = useState<KcUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [addQuery, setAddQuery] = useState("");
  const [results, setResults] = useState<KcUser[]>([]);
  const memberRequest = useRef(0);
  const userSearchRequest = useRef(0);

  const load = useCallback(async () => {
    if (!group) return;
    const request = ++memberRequest.current;
    setLoading(true);
    try {
      const data = await api<{ members: KcUser[] }>(`/api/pca/groups/${group.id}/members`);
      if (request === memberRequest.current) setMembers(data.members);
    } catch (err) {
      if (request === memberRequest.current) {
        setMembers([]);
        toast.error(errMsg(err));
      }
    } finally {
      if (request === memberRequest.current) setLoading(false);
    }
  }, [group]);

  useEffect(() => {
    if (group) {
      setMemberQuery("");
      setAddQuery("");
      setResults([]);
      load();
    }
  }, [group, load]);

  async function search(q: string) {
    const request = ++userSearchRequest.current;
    setAddQuery(q);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const data = await api<{ users: KcUser[] }>(`/api/pca/users-search?search=${encodeURIComponent(q)}`);
    if (request === userSearchRequest.current) {
      setResults(data.users.filter((u) => !members.find((m) => m.id === u.id)));
    }
  }

  async function add(u: KcUser) {
    if (!group) return;
    try {
      await api(`/api/pca/groups/${group.id}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: u.id }),
      });
      setAddQuery("");
      setResults([]);
      await load();
      onChanged();
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  async function remove(u: KcUser) {
    if (!group) return;
    try {
      await api(`/api/pca/groups/${group.id}/members/${u.id}`, { method: "DELETE" });
      await load();
      onChanged();
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  const filteredMembers = members.filter((user) => {
    const query = memberQuery.trim().toLowerCase();
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").toLowerCase();
    return (
      !query ||
      user.username?.toLowerCase().includes(query) ||
      user.email?.toLowerCase().includes(query) ||
      fullName.includes(query)
    );
  });
  const breadcrumb = group?.path.split("/").filter(Boolean) ?? [];

  return (
    <section className="bg-blue-50/70 p-4 dark:bg-blue-950/20">
      {!group ? (
        <div className="flex min-h-[420px] flex-col items-center justify-center text-center text-muted-foreground">
          <Users className="mb-2 h-8 w-8 opacity-50" />
          <p className="text-sm">Select a group to view its members.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold">Direct members</p>
            <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground" aria-label="Selected group hierarchy">
              {breadcrumb.map((segment, index) => (
                <span key={breadcrumb.slice(0, index + 1).join("/")} className="flex items-center gap-1">
                  {index > 0 && <ChevronRight className="h-3 w-3" />}
                  <span className={index === breadcrumb.length - 1 ? "font-semibold text-foreground" : ""}>{segment}</span>
                </span>
              ))}
            </div>
          </div>

          <Input
            value={memberQuery}
            onChange={(event) => setMemberQuery(event.target.value)}
            placeholder="Filter current members..."
            className="bg-background"
          />

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading members...
            </div>
          ) : (
            <div className="max-h-[270px] space-y-1.5 overflow-y-auto pr-1">
              {filteredMembers.map((user) => (
                <div key={user.id} className="flex items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{user.username}</p>
                    {user.email && <p className="truncate text-xs text-muted-foreground">{user.email}</p>}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => remove(user)}>Remove</Button>
                </div>
              ))}
              {filteredMembers.length === 0 && (
                <p className="py-5 text-center text-sm text-muted-foreground">
                  {memberQuery ? "No current members match." : "No direct members in this group."}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2 border-t border-blue-200 pt-4 dark:border-blue-900">
            <Label>Add an existing user</Label>
            <Input
              placeholder="Search username, name, or email..."
              value={addQuery}
              onChange={(event) => search(event.target.value)}
              className="bg-background"
            />
            {results.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg border bg-background p-1 text-sm">
                {results.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => add(user)}
                    className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent"
                  >
                    <span className="font-medium">+ {user.username}</span>
                    {user.email && <span className="ml-1 text-xs text-muted-foreground">({user.email})</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
