import { NextRequest, NextResponse } from "next/server";
import { requireRealmAdmin } from "@/lib/session";
import { listAdminActions } from "@/db/actionLog";

function optionalDate(value: string | null, endOfDay = false): Date | undefined {
  if (value === null || value === "") return undefined;
  const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
  const date = new Date(`${value}T${time}+05:30`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(req: NextRequest) {
  const auth = await requireRealmAdmin();
  if (auth.ok === false) return auth.response;
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(10, Number(req.nextUrl.searchParams.get("pageSize") ?? "50") || 50));
  const outcomeValue = req.nextUrl.searchParams.get("outcome");
  const outcome = outcomeValue === "success" || outcomeValue === "failure" ? outcomeValue : undefined;
  const actions = await listAdminActions({
    page, pageSize,
    action: req.nextUrl.searchParams.get("action")?.trim() || undefined,
    outcome,
    from: optionalDate(req.nextUrl.searchParams.get("from")),
    to: optionalDate(req.nextUrl.searchParams.get("to"), true),
  });
  return NextResponse.json({ actions, page, pageSize, hasMore: actions.length === pageSize });
}
