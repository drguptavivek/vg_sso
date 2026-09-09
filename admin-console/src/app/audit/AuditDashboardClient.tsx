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
const actionLabels: Record<string, string> = {
  "user.create": "User created",
  "user.profile.update": "User profile updated",
  "user.status.update": "Account enabled or disabled",
  "user.onboarding.resend": "Onboarding email resent",
};

function friendlySummary(summary: Record<string, unknown>) {
  const username = typeof summary.username === "string" ? summary.username : null;
  const email = typeof summary.email === "string" && summary.email ? summary.email : null;
  const phoneNumber = typeof summary.phoneNumber === "string" && summary.phoneNumber ? summary.phoneNumber : null;
  const values = Array.isArray(summary.fields) ? summary.fields : Array.isArray(summary.profileFields) ? summary.profileFields : [];
  const fields = values.filter((value): value is string => typeof value === "string").map((value) => value.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase());
  return [username ? `User: ${username}` : "", email ? `Email: ${email}` : "", phoneNumber ? `Phone: ${phoneNumber}` : "", fields.length ? `Changed: ${fields.join(", ")}` : "", summary.hrmsAttached === true ? "HRMS record linked" : ""].filter(Boolean).join(" · ") || "No additional details";
}


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
      if (!response.ok) throw new Error(data.error || "We could not load the activity log. Please try again.");
      setActions(data.actions); setPage(requestedPage); setHasMore(data.hasMore);
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }, [action, outcome, from, to]);
  useEffect(() => { void load(1); }, [load]);
  return <div className="mx-auto w-full max-w-[1920px] space-y-6 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Administrative activity</h1><p className="text-sm text-muted-foreground">Changes made through SSO Admin · Signed in as {username}</p></div>
      <div className="flex gap-2"><Button variant="outline" asChild><a href="/hr">HR users</a></Button><Button variant="outline" onClick={() => load(page)} disabled={loading}><RefreshCw /> Refresh</Button><SignOutButton /></div></div>
    <Card><CardHeader><CardTitle>Activity log</CardTitle><CardDescription>Review user-management changes. Sensitive values and raw HRMS responses are never stored here.</CardDescription></CardHeader>
      <CardContent className="space-y-4"><div className="grid gap-3 md:grid-cols-4">
        <div><Label htmlFor="audit-action">Activity</Label><select id="audit-action" value={action} onChange={(e) => setAction(e.target.value)} className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">All activities</option><option value="user.create">User created</option><option value="user.profile.update">User profile updated</option><option value="user.status.update">Account enabled or disabled</option><option value="user.onboarding.resend">Onboarding email resent</option></select></div>
        <div><Label htmlFor="audit-outcome">Result</Label><select id="audit-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">All results</option><option value="success">Completed successfully</option><option value="failure">Failure</option></select></div>
        <div><Label htmlFor="audit-from">From date</Label><Input id="audit-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label htmlFor="audit-to">To date</Label><Input id="audit-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div></div>
        {loading ? <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="animate-spin" /> Loading activity…</div> : <Table><TableHeader><TableRow><TableHead>Date and time</TableHead><TableHead>Performed by</TableHead><TableHead>Activity</TableHead><TableHead>Affected user</TableHead><TableHead>Result</TableHead><TableHead>Details</TableHead></TableRow></TableHeader><TableBody>{actions.map((row) => <TableRow key={row.id}><TableCell className="whitespace-nowrap">{new Date(row.occurredAt).toLocaleString()}</TableCell><TableCell>{row.actorUsername || row.actorUserId}</TableCell><TableCell>{actionLabels[row.action] ?? row.action}</TableCell><TableCell className="font-mono text-xs">{row.targetUserId ? `${row.targetUserId.slice(0, 8)}…` : "Not applicable"}</TableCell><TableCell><Badge variant={row.outcome === "success" ? "success" : "destructive"}>{row.outcome === "success" ? "Completed" : "Failed"}</Badge></TableCell><TableCell className="max-w-xl break-words text-xs">{friendlySummary(row.summary ?? {})}</TableCell></TableRow>)}</TableBody></Table>}
        <div className="flex justify-between"><Button variant="outline" disabled={page === 1 || loading} onClick={() => load(page - 1)}>Previous</Button><span className="text-sm text-muted-foreground">Page {page}</span><Button variant="outline" disabled={!hasMore || loading} onClick={() => load(page + 1)}>Next</Button></div>
      </CardContent></Card>
  </div>;
}
