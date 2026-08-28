"use client";
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SignOutButton } from "@/components/SignOutButton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface ActionLogRow { id: string; occurredAt: string; actorUserId: string; actorUsername?: string | null; targetUserId?: string | null; action: string; outcome: "success" | "failure"; summary: Record<string, unknown>; }

export default function AuditDashboardClient({ username }: { username: string }) {
  const [actions, setActions] = useState<ActionLogRow[]>([]);
  const [page, setPage] = useState(1); const [hasMore, setHasMore] = useState(false);
  const [action, setAction] = useState(""); const [outcome, setOutcome] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [loading, setLoading] = useState(false);
  const load = useCallback(async (requestedPage: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(requestedPage), pageSize: "50" });
      if (action.trim()) params.set("action", action.trim()); if (outcome) params.set("outcome", outcome);
      if (from) params.set("from", from); if (to) params.set("to", to);
      const response = await fetch(`/api/audit/actions?${params}`, { cache: "no-store" }); const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load action log");
      setActions(data.actions); setPage(requestedPage); setHasMore(data.hasMore);
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }, [action, outcome, from, to]);
  useEffect(() => { void load(1); }, [load]);
  return <div className="mx-auto w-full max-w-[1920px] space-y-6 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Admin action log</h1><p className="text-sm text-muted-foreground">Realm-admin view · Signed in as {username}</p></div>
      <div className="flex gap-2"><Button variant="outline" asChild><a href="/hr">HR users</a></Button><Button variant="outline" onClick={() => load(page)} disabled={loading}><RefreshCw /> Refresh</Button><SignOutButton /></div></div>
    <Card><CardHeader><CardTitle>Next.js administrative changes</CardTitle><CardDescription>Redacted actions performed through this console. Secrets and raw HRMS responses are never recorded.</CardDescription></CardHeader>
      <CardContent className="space-y-4"><div className="grid gap-3 md:grid-cols-4">
        <div><Label htmlFor="audit-action">Action</Label><Input id="audit-action" value={action} onChange={(e) => setAction(e.target.value)} placeholder="user.profile.update" /></div>
        <div><Label htmlFor="audit-outcome">Outcome</Label><select id="audit-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Any</option><option value="success">Success</option><option value="failure">Failure</option></select></div>
        <div><Label htmlFor="audit-from">From</Label><Input id="audit-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label htmlFor="audit-to">To</Label><Input id="audit-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div></div>
        {loading ? <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="animate-spin" /> Loading actions...</div> : <Table><TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Target</TableHead><TableHead>Outcome</TableHead><TableHead>Summary</TableHead></TableRow></TableHeader><TableBody>{actions.map((row) => <TableRow key={row.id}><TableCell className="whitespace-nowrap">{new Date(row.occurredAt).toLocaleString()}</TableCell><TableCell>{row.actorUsername || row.actorUserId}</TableCell><TableCell><code>{row.action}</code></TableCell><TableCell className="font-mono text-xs">{row.targetUserId || "—"}</TableCell><TableCell><Badge variant={row.outcome === "success" ? "success" : "destructive"}>{row.outcome}</Badge></TableCell><TableCell className="max-w-xl break-words text-xs">{JSON.stringify(row.summary)}</TableCell></TableRow>)}</TableBody></Table>}
        <div className="flex justify-between"><Button variant="outline" disabled={page === 1 || loading} onClick={() => load(page - 1)}>Previous</Button><span className="text-sm text-muted-foreground">Page {page}</span><Button variant="outline" disabled={!hasMore || loading} onClick={() => load(page + 1)}>Next</Button></div>
      </CardContent></Card>
  </div>;
}
