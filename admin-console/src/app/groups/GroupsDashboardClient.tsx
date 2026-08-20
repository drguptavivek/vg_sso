"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, FolderTree, Loader2, Plus, Users } from "lucide-react";
import type { GroupTreeNode, KcUser } from "@/types/keycloak";
import { Button } from "@/components/ui/button";
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

export default function GroupsDashboardClient({ username }: { username: string }) {
  const [roots, setRoots] = useState<GroupTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [membersFor, setMembersFor] = useState<GroupTreeNode | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ roots: GroupTreeNode[] }>("/api/pca/my-groups");
      setRoots(data.roots);
    } catch (err) {
      toast.error(errMsg(err));
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
      toast.success(`Created "${name.trim()}".`);
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

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Client App Group Management</h1>
          <p className="text-sm text-muted-foreground">Signed in as {username}</p>
        </div>
        <Button variant="ghost" asChild>
          <a href="/api/auth/signout">Sign out</a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your groups</CardTitle>
          <CardDescription>
            Create, rename, and delete subgroups, and manage membership, anywhere inside the groups you
            administer below. Root groups themselves cannot be renamed or deleted.
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
              <p>You are not a delegated administrator of any client application group yet.</p>
              <p className="text-sm">Ask a realm admin or a client-manager to add you.</p>
            </div>
          )}
          <div className="space-y-1">
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

      <MembersDialog group={membersFor} onOpenChange={(open) => !open && setMembersFor(null)} />
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
    <div>
      <div
        className="flex flex-wrap items-center gap-2 rounded-md py-1.5 hover:bg-accent/50"
        style={{ paddingLeft: depth * 20 }}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="w-6" />
        )}
        <span className="font-medium">{node.name}</span>
        {isRoot && <Badge variant="secondary">app root</Badge>}
        <span className="text-xs text-muted-foreground">{node.path}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => onCreateChild(node)}>
            <Plus /> Subgroup
          </Button>
          <Button size="sm" variant="outline" onClick={() => onMembers(node)}>
            <Users /> Members
          </Button>
          {!isRoot && (
            <>
              <Button size="sm" variant="outline" onClick={() => onRename(node)}>
                Rename
              </Button>
              <Button size="sm" variant="destructive" onClick={() => onDelete(node)}>
                Delete
              </Button>
            </>
          )}
        </div>
      </div>
      {expanded &&
        node.children.map((child) => (
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
